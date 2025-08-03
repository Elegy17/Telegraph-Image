// Cloudflare Worker Image Proxy - Enhanced Version with Fixes
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
            const refererHost = new URL(referer).hostname.toLowerCase();
            if (!matchDomain(refererHost, domains)) {
                return new Response('权限不足', { status: 403 });
            }
        } catch (e) {
            return new Response('权限不足', { status: 403 });
        }
    }

    // 2. 图片地址构造
    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search;

    // 3. Telegram 文件解析
    if (url.pathname.length > 39) {
        const fileIdParts = url.pathname.split(".")[0].split("/");
        const fileId = fileIdParts.length > 2 ? fileIdParts[2] : null;

        if (fileId) {
            const filePath = await getFilePath(env, fileId);
            if (filePath) fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        }
    }

    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) return response;

    // 4. 管理员绕过
    if (request.headers.get('Referer')?.includes(`${url.origin}/admin`)) {
        return response;
    }

    // 5. KV 存储元数据
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
    const metadata = record.metadata;

    // 6. 图片内容黑白名单
    const userAgent = request.headers.get('User-Agent') || '';
    const referer = request.headers.get('Referer');
    const isBrowser = /mozilla/i.test(userAgent) && !/discord|telegram|bot|curl|axios/i.test(userAgent);
    const isMdViewer = !isBrowser;

    if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const redirectUrl = isMdViewer
            ? "https://static-res.pages.dev/teleimage/img-block-compressed.png"
            : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    // 7. 白名单开启模式
    if (env.WhiteList_Mode === "true") {
        const WAIT_IMG = "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/IMG_20250803_052417.png";
        return Response.redirect(
            isMdViewer ? WAIT_IMG : `${url.origin}/whitelist-on.html`,
            302
        );
    }

    // 8. 防盗链模式判断（需配合 ListType=White 才允许）
    const HOTLINK_MODE = (env.HOTLINK_MODE || "WHITELIST").toUpperCase();
    const EMPTY_REFERER_ACTION = (env.EMPTY_REFERER_ACTION || "BLOCK").toUpperCase();
    const BLOCK_IMG = "https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png";
    const REDIRECT_IMG = "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/IMG_20250803_070454.png";

    if (!referer) {
        switch (EMPTY_REFERER_ACTION) {
            case "ALLOW": break;
            case "REDIRECT": return Response.redirect(isMdViewer ? REDIRECT_IMG : url.origin, 302);
            case "BLOCK":
            default: return Response.redirect(BLOCK_IMG, 302);
        }
    } else {
        try {
            const refererHost = new URL(referer).hostname.toLowerCase();

            if (
                (HOTLINK_MODE === "WHITELIST" && env.ALLOWED_DOMAINS &&
                    !matchDomain(refererHost, env.ALLOWED_DOMAINS.split(","))) ||
                (HOTLINK_MODE === "BLACKLIST" && env.BLOCKED_DOMAINS &&
                    matchDomain(refererHost, env.BLOCKED_DOMAINS.split(",")))
            ) {
                return Response.redirect(BLOCK_IMG, 302);
            }
        } catch (e) {
            return Response.redirect(BLOCK_IMG, 302);
        }
    }

    // 9. 内容审核（Moderate）
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
                        const redirectUrl = isMdViewer
                            ? "https://static-res.pages.dev/teleimage/img-block-compressed.png"
                            : `${url.origin}/block-img.html`;
                        return Response.redirect(redirectUrl, 302);
                    }
                }
            }
        } catch (_) { }
    }

    // 10. 返回最终图片
    await env.img_url.put(params.id, "", { metadata });
    return response;
}

// 工具函数：域名匹配
function matchDomain(refererHost, domainList) {
    for (const domain of domainList) {
        const cleanDomain = domain.trim().toLowerCase();
        if (cleanDomain.startsWith("*.") &&
            (refererHost === cleanDomain.slice(2) || refererHost.endsWith(`.${cleanDomain.slice(2)}`))) {
            return true;
        } else if (refererHost === cleanDomain) {
            return true;
        }
    }
    return false;
}

// 工具函数：获取 Telegram 文件路径
async function getFilePath(env, file_id) {
    try {
        const apiUrl = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(apiUrl);
        if (!res.ok) return null;
        const json = await res.json();
        return json.ok && json.result ? json.result.file_path : null;
    } catch (_) {
        return null;
    }
}
