export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);
    const method = request.method;

    const referer = request.headers.get('Referer');
    const refererHost = referer ? new URL(referer).hostname.toLowerCase() : null;
    const userAgent = request.headers.get('User-Agent') || '';
    const isBrowser = userAgent.includes('Mozilla') && 
                      !userAgent.includes('bot') &&
                      !userAgent.includes('Discord') &&
                      !userAgent.includes('Telegram');

    const isMDClient = !isBrowser;

    // 上传限制（POST）
    if (method === "POST" && env.UPLOAD_DOMAINS) {
        const domains = env.UPLOAD_DOMAINS.split(",").map(d => d.trim().toLowerCase());
        if (!refererHost || !domains.some(domain => domainMatch(domain, refererHost))) {
            return new Response('权限不足', { status: 403 });
        }
    }

    // 构建图片 URL
    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    if (url.pathname.length > 39) {
        const fileIdParts = url.pathname.split(".")[0].split("/");
        const fileId = fileIdParts.length > 2 ? fileIdParts[2] : null;
        if (fileId) {
            const filePath = await getFilePath(env, fileId);
            if (filePath) {
                fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
            }
        }
    }

    const baseResponse = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!baseResponse.ok) return baseResponse;

    // 管理员访问直接通过
    const isAdmin = referer?.includes(`${url.origin}/admin`);
    if (isAdmin) return baseResponse;

    // 获取/初始化元数据
    if (!env.img_url) return baseResponse;

    let record = await env.img_url.getWithMetadata(params.id);
    if (!record || !record.metadata) {
        record = {
            metadata: {
                ListType: "None",
                Label: "None",
                TimeStamp: Date.now(),
                liked: false,
                fileName: params.id,
                fileSize: 0,
            }
        };
        await env.img_url.put(params.id, "", { metadata: record.metadata });
    }

    const metadata = {
        ...record.metadata,
        ListType: record.metadata.ListType || "None",
        Label: record.metadata.Label || "None",
        TimeStamp: record.metadata.TimeStamp || Date.now(),
        liked: record.metadata.liked ?? false,
        fileName: record.metadata.fileName || params.id,
        fileSize: record.metadata.fileSize || 0,
    };

    const blockImg = "https://static-res.pages.dev/teleimage/img-block-compressed.png";
    const blockHtml = `${url.origin}/block-img.html`;
    const whitelistImg = "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/IMG_20250803_052417.png";
    const whitelistHtml = `${url.origin}/whitelist-on.html`;
    const hotlinkImg = "https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png";
    const redirectImg = "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/IMG_20250803_070454.png";

    // === ListType 检查（白名单/黑名单图片）
    const shouldBlockByListType = () => {
        if (metadata.ListType === "White") {
            // 若不在白名单 Referer 域名中，仍应拦截
            if (!checkRefererAllow(env, refererHost)) return true;
            return false;
        }
        if (metadata.ListType === "Block" || metadata.Label === "adult") {
            return true;
        }
        return false;
    };

    if (shouldBlockByListType()) {
        return Response.redirect(isMDClient ? blockImg : blockHtml, 302);
    }

    // === 全局白名单模式
    if (env.WhiteList_Mode === "true") {
        return Response.redirect(referer ? whitelistImg : whitelistHtml, 302);
    }

    // === 防盗链处理（WHITELIST / BLACKLIST）
    const mode = (env.HOTLINK_MODE || "WHITELIST").toUpperCase();
    const emptyRefererAction = (env.EMPTY_REFERER_ACTION || "BLOCK").toUpperCase();

    if (mode === "WHITELIST" || mode === "BLACKLIST") {
        if (!refererHost) {
            switch (emptyRefererAction) {
                case "ALLOW": break;
                case "REDIRECT":
                    return Response.redirect(isBrowser ? url.origin : redirectImg, 302);
                case "BLOCK":
                default:
                    return Response.redirect(hotlinkImg, 302);
            }
        } else {
            const list = mode === "WHITELIST" ? env.ALLOWED_DOMAINS : env.BLOCKED_DOMAINS;
            if (list) {
                const domains = list.split(",").map(d => d.trim().toLowerCase());
                const matched = domains.some(domain => domainMatch(domain, refererHost));
                const shouldBlock = mode === "WHITELIST" ? !matched : matched;
                if (shouldBlock) {
                    return Response.redirect(hotlinkImg, 302);
                }
            }
        }
    }

    // === 内容审核（如果启用）
    if (env.ModerateContentApiKey) {
        try {
            const res = await fetch(`https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`);
            if (res.ok) {
                const data = await res.json();
                if (data?.rating_label) {
                    metadata.Label = data.rating_label;
                    if (data.rating_label === "adult") {
                        await env.img_url.put(params.id, "", { metadata });
                        return Response.redirect(isMDClient ? blockImg : blockHtml, 302);
                    }
                }
            }
        } catch {}
    }

    // === 保存 metadata 并返回图片
    await env.img_url.put(params.id, "", { metadata });
    return baseResponse;
}

// 辅助函数：域名匹配
function domainMatch(pattern, host) {
    if (pattern.startsWith("*.")) {
        const base = pattern.slice(2);
        return host === base || host.endsWith("." + base);
    }
    return host === pattern;
}

// 获取Telegram文件路径
async function getFilePath(env, file_id) {
    try {
        const res = await fetch(`https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`);
        if (!res.ok) return null;
        const json = await res.json();
        return json.ok && json.result ? json.result.file_path : null;
    } catch {
        return null;
    }
}

// 检查referer是否在允许列表内
function checkRefererAllow(env, host) {
    const list = env.ALLOWED_DOMAINS;
    if (!host || !list) return false;
    return list.split(",").map(d => d.trim().toLowerCase()).some(domain => domainMatch(domain, host));
}
