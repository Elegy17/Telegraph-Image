export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);
    const method = request.method;

    // 1. 上传限制功能
    if (method === "POST" && env.UPLOAD_DOMAINS) {
        const domains = env.UPLOAD_DOMAINS.split(",");
        const referer = request.headers.get('Referer');

        if (!referer) return new Response('权限不足', { status: 403 });

        try {
            const refererUrl = new URL(referer);
            const refererHost = refererUrl.hostname.toLowerCase();
            let isAllowed = domains.some(domain => {
                const cleanDomain = domain.trim().toLowerCase();
                return cleanDomain.startsWith("*.")
                    ? refererHost === cleanDomain.slice(2) || refererHost.endsWith(`.${cleanDomain.slice(2)}`)
                    : refererHost === cleanDomain;
            });
            if (!isAllowed) return new Response('权限不足', { status: 403 });
        } catch (e) {
            return new Response('权限不足', { status: 403 });
        }
    }

    // 2. 图片路径与TG文件代理
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

    const fetchResponse = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!fetchResponse.ok) return fetchResponse;

    // 3. 管理员绕过
    if (request.headers.get('Referer')?.includes(`${url.origin}/admin`)) return fetchResponse;

    // 4. KV元数据处理
    if (!env.img_url) return fetchResponse;

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
    const metadata = { ...record.metadata };

    // 5. 审查标签和黑白名单预处理
    if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const referer = request.headers.get('Referer');
        const redirectUrl = referer
            ? "https://static-res.pages.dev/teleimage/img-block-compressed.png"
            : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    // 6. Global Whitelist_Mode
    const referer = request.headers.get('Referer');
    const refererHost = referer ? new URL(referer).hostname.toLowerCase() : null;
    const userAgent = request.headers.get('User-Agent') || '';
    const isMarkdown = isMarkdownAccess(userAgent);

    if (env.WhiteList_Mode === "true") {
        const whitelist = (env.ALLOWED_DOMAINS || '').split(',');
        if (!refererHost || !checkDomainList(refererHost, whitelist)) {
            return Response.redirect(
                isMarkdown
                    ? "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/IMG_20250803_052417.png"
                    : `${url.origin}/whitelist-on.html`,
                302
            );
        }
    }

    // 7. 防盗链处理
    const HOTLINK_MODE = (env.HOTLINK_MODE || "WHITELIST").toUpperCase();
    const EMPTY_REFERER_ACTION = (env.EMPTY_REFERER_ACTION || "BLOCK").toUpperCase();

    const HOTLINK_BLOCK_IMAGE = "https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png";
    const REDIRECT_IMAGE = "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/IMG_20250803_070454.png";

    const allow = shouldAllowAccess(refererHost, env, metadata, HOTLINK_MODE, userAgent);
    if (!allow) {
        return Response.redirect(isMarkdown ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : HOTLINK_BLOCK_IMAGE, 302);
    }

    // 8. 内容审核
    if (env.ModerateContentApiKey) {
        try {
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
            const moderateResponse = await fetch(moderateUrl);
            if (moderateResponse.ok) {
                const moderateData = await moderateResponse.json();
                if (moderateData && moderateData.rating_label) {
                    metadata.Label = moderateData.rating_label;
                    if (metadata.Label === "adult") {
                        await env.img_url.put(params.id, "", { metadata });
                        const redirectUrl = referer
                            ? "https://static-res.pages.dev/teleimage/img-block-compressed.png"
                            : `${url.origin}/block-img.html`;
                        return Response.redirect(redirectUrl, 302);
                    }
                }
            }
        } catch (_) {}
    }

    // 9. 返回图片
    await env.img_url.put(params.id, "", { metadata });
    return fetchResponse;
}

function isMarkdownAccess(userAgent) {
    return !(userAgent.includes('Mozilla') && !userAgent.match(/bot|Telegram|Discord/i));
}

function isDomainMatch(host, pattern) {
    if (pattern.startsWith("*.")) {
        const base = pattern.slice(2).toLowerCase();
        return host === base || host.endsWith(`.${base}`);
    } else {
        return host === pattern.toLowerCase();
    }
}

function checkDomainList(host, domainList) {
    return domainList.some(pattern => isDomainMatch(host, pattern.trim()));
}

function shouldAllowAccess(refererHost, env, metadata, mode, userAgent) {
    const isMarkdown = isMarkdownAccess(userAgent);
    const listType = metadata.ListType || "None";
    const label = metadata.Label || "None";

    if (listType === "Block" || label === "adult") return false;

    if (env.WhiteList_Mode === "true") {
        const whitelist = (env.ALLOWED_DOMAINS || "").split(",");
        return refererHost && checkDomainList(refererHost, whitelist);
    }

    if (!refererHost) {
        switch ((env.EMPTY_REFERER_ACTION || "BLOCK").toUpperCase()) {
            case "ALLOW": return true;
            case "REDIRECT": return false;
            case "BLOCK":
            default: return false;
        }
    }

    if (mode === "WHITELIST") {
        const whitelist = (env.ALLOWED_DOMAINS || "").split(",");
        return checkDomainList(refererHost, whitelist);
    } else if (mode === "BLACKLIST") {
        const blacklist = (env.BLOCKED_DOMAINS || "").split(",");  
        return !checkDomainList(refererHost, blacklist);
    }

    return true;
}

async function getFilePath(env, file_id) {
    try {
        const apiUrl = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(apiUrl);
        if (!res.ok) return null;
        const responseData = await res.json();
        if (responseData.ok && responseData.result) return responseData.result.file_path;
        return null;
    } catch (_) {
        return null;
    }
}
