export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);
    const method = request.method;
    const referer = request.headers.get('Referer');
    const userAgent = request.headers.get('User-Agent') || '';
    const refererHost = referer ? (new URL(referer)).hostname.toLowerCase() : null;

    // 判断是否为 Markdown / 嵌入式客户端
    function isMarkdownClient(ua) {
        return (
            !ua.includes("Mozilla") ||
            ua.includes("Discord") ||
            ua.includes("Telegram") ||
            ua.includes("curl") ||
            ua.includes("bot") ||
            ua.includes("github") ||
            ua.includes("Slack")
        );
    }

    // 防盗链辅助判断：Referer 是否应被允许
    function isAllowedReferer(refererHost, domains) {
        for (const domain of domains) {
            const clean = domain.trim().toLowerCase();
            if (clean.startsWith("*.")) {
                const base = clean.slice(2);
                if (refererHost === base || refererHost.endsWith(`.${base}`)) return true;
            } else if (refererHost === clean) return true;
        }
        return false;
    }

    // 上传限制功能
    if (method === "POST" && env.UPLOAD_DOMAINS) {
        if (!refererHost || !isAllowedReferer(refererHost, env.UPLOAD_DOMAINS.split(","))) {
            return new Response("权限不足", { status: 403 });
        }
    }

    // 构造默认图片 URL
    let fileUrl = 'https://telegra.ph' + url.pathname + url.search;

    // 支持 Telegram 文件
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

    const response = await fetch(fileUrl, {
        method,
        headers: request.headers,
        body: request.body
    });

    // 管理后台绕过所有防护
    if (referer && referer.includes(`${url.origin}/admin`)) {
        return response;
    }

    // 加载 KV 元数据
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
        ListType: record.metadata.ListType || "None",
        Label: record.metadata.Label || "None",
        TimeStamp: record.metadata.TimeStamp || Date.now(),
        liked: record.metadata.liked !== undefined ? record.metadata.liked : false,
        fileName: record.metadata.fileName || params.id,
        fileSize: record.metadata.fileSize || 0,
    };

    // 内容审核处理
    if (env.ModerateContentApiKey) {
        try {
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
            const moderateResponse = await fetch(moderateUrl);
            if (moderateResponse.ok) {
                const moderateData = await moderateResponse.json();
                if (moderateData?.rating_label) {
                    metadata.Label = moderateData.rating_label;
                    if (moderateData.rating_label === "adult") {
                        await env.img_url.put(params.id, "", { metadata });
                        const redirect = isMarkdownClient(userAgent)
                            ? "https://static-res.pages.dev/teleimage/img-block-compressed.png"
                            : `${url.origin}/block-img.html`;
                        return Response.redirect(redirect, 302);
                    }
                }
            }
        } catch (e) { /* 静默失败 */ }
    }

    // ⚪ WhiteList_Mode 审核逻辑优先级最高
    if (env.WhiteList_Mode === "true") {
        const redirect = isMarkdownClient(userAgent)
            ? "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/IMG_20250803_052417.png"
            : `${url.origin}/whitelist-on.html`;
        return Response.redirect(redirect, 302);
    }

    // 黑白名单处理逻辑（优先级高于防盗链）
    if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const redirect = isMarkdownClient(userAgent)
            ? "https://static-res.pages.dev/teleimage/img-block-compressed.png"
            : `${url.origin}/block-img.html`;
        return Response.redirect(redirect, 302);
    }

    if (metadata.ListType === "White") {
        // 需要 Referer 存在 且在白名单列表中才允许
        if (refererHost && env.ALLOWED_DOMAINS && isAllowedReferer(refererHost, env.ALLOWED_DOMAINS.split(","))) {
            await env.img_url.put(params.id, "", { metadata });
            return response;
        } else {
            // 非白名单直接拦截
            const redirect = isMarkdownClient(userAgent)
                ? "https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png"
                : `${url.origin}/block-img.html`;
            return Response.redirect(redirect, 302);
        }
    }

    // 双模式防盗链系统
    const HOTLINK_MODE = (env.HOTLINK_MODE || "WHITELIST").toUpperCase();
    const EMPTY_REFERER_ACTION = (env.EMPTY_REFERER_ACTION || "BLOCK").toUpperCase();

    const HOTLINK_BLOCK_IMAGE = "https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png";
    const REDIRECT_IMAGE = "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/IMG_20250803_070454.png";

    if (!referer) {
        // 空 Referer 行为
        switch (EMPTY_REFERER_ACTION) {
            case "ALLOW":
                break;
            case "REDIRECT":
                return Response.redirect(isMarkdownClient(userAgent) ? REDIRECT_IMAGE : url.origin, 302);
            case "BLOCK":
            default:
                return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
        }
    } else {
        try {
            let shouldBlock = false;

            if (HOTLINK_MODE === "WHITELIST" && env.ALLOWED_DOMAINS) {
                if (!isAllowedReferer(refererHost, env.ALLOWED_DOMAINS.split(","))) {
                    shouldBlock = true;
                }
            }

            if (HOTLINK_MODE === "BLACKLIST" && env.BLOCKED_DOMAINS) {
                if (isAllowedReferer(refererHost, env.BLOCKED_DOMAINS.split(","))) {
                    shouldBlock = true;
                }
            }

            if (shouldBlock) {
                return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
            }
        } catch (e) {
            return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
        }
    }

    // 最终成功访问，保存元数据
    await env.img_url.put(params.id, "", { metadata });
    return response;
}

// 获取 Telegram 文件路径
async function getFilePath(env, file_id) {
    try {
        const apiUrl = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(apiUrl);
        if (!res.ok) return null;
        const json = await res.json();
        return json?.ok && json.result?.file_path ? json.result.file_path : null;
    } catch {
        return null;
    }
}
