export async function onRequest(context) {
    const { request, env, params } = context;

    const url = new URL(request.url);
    const method = request.method;
    const referer = request.headers.get('Referer');
    const refererHost = referer ? new URL(referer).hostname.toLowerCase() : null;

    // ====== 公共辅助函数：匹配域名 ======
    function matchDomain(host, domainList) {
        for (const domain of domainList) {
            const clean = domain.trim().toLowerCase();
            if (clean.startsWith("*.")) {
                const base = clean.slice(2);
                if (host === base || host.endsWith(`.${base}`)) return true;
            } else if (host === clean) return true;
        }
        return false;
    }

    // ====== 1. 上传限制 ======
    if (method === "POST" && env.UPLOAD_DOMAINS) {
        if (!refererHost || !matchDomain(refererHost, env.UPLOAD_DOMAINS.split(","))) {
            return new Response('权限不足', { status: 403 });
        }
    }

    // ====== 2. 生成 fileUrl（不修改） ======
    let fileUrl = 'https://telegra.ph' + url.pathname + url.search;

    const pathParts = url.pathname.split("/");
    const fileId = pathParts.length > 2 ? pathParts[2].split(".")[0] : null;

    if (fileId) {
        const filePath = await getFilePath(env, fileId);
        if (filePath) {
            fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
        }
    }

    // ====== 3. 管理员请求绕过所有检查 ======
    const isAdmin = referer?.includes(`${url.origin}/admin`);
    if (isAdmin) {
        return fetch(fileUrl, {
            method: request.method,
            headers: request.headers,
            body: request.body,
        });
    }

    // ====== 4. 请求目标图片 ======
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) {
        return response;
    }

    // ====== 5. KV 元数据处理 ======
    if (!env.img_url) {
        return response;
    }

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

    let metadata = {
        ListType: record.metadata.ListType ?? "None",
        Label: record.metadata.Label ?? "None",
        TimeStamp: record.metadata.TimeStamp ?? Date.now(),
        liked: record.metadata.liked ?? false,
        fileName: record.metadata.fileName ?? params.id,
        fileSize: record.metadata.fileSize ?? 0,
    };

    // ====== 6. 黑名单或敏感内容屏蔽逻辑（优先于防盗链） ======
    if (metadata.ListType === "White") {
        return response;
    } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    // ====== 7. 全局白名单开关检查 ======
    if (env.WhiteList_Mode && env.WhiteList_Mode === "true") {
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    // ====== 8. 内容审核（如果启用） ======
    if (env.ModerateContentApiKey) {
        try {
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=${encodeURIComponent(fileUrl)}`;
            const moderateResponse = await fetch(moderateUrl);
            if (moderateResponse.ok) {
                const moderateData = await moderateResponse.json();
                if (moderateData?.rating_label) {
                    metadata.Label = moderateData.rating_label;
                    if (moderateData.rating_label === "adult") {
                        await env.img_url.put(params.id, "", { metadata });
                        return Response.redirect(`${url.origin}/block-img.html`, 302);
                    }
                }
            }
        } catch (_) {
            // 忽略内容审核失败
        }
    }

    // ====== 9. 防盗链检查（延后执行） ======
    const HOTLINK_BLOCK_IMAGE = "https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png";
    const HOTLINK_MODE = (env.HOTLINK_MODE || "WHITELIST").toUpperCase();
    const EMPTY_REFERER_ACTION = (env.EMPTY_REFERER_ACTION || "BLOCK").toUpperCase();

    if (HOTLINK_MODE === "WHITELIST" || HOTLINK_MODE === "BLACKLIST") {
        if (!refererHost) {
            switch (EMPTY_REFERER_ACTION) {
                case "ALLOW": break;
                case "REDIRECT": return Response.redirect(url.origin, 302);
                case "BLOCK":
                default:
                    return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
            }
        } else {
            let shouldBlock = false;

            if (HOTLINK_MODE === "WHITELIST" && env.ALLOWED_DOMAINS) {
                if (!matchDomain(refererHost, env.ALLOWED_DOMAINS.split(","))) {
                    shouldBlock = true;
                }
            }

            if (HOTLINK_MODE === "BLACKLIST" && env.BLOCKED_DOMAINS) {
                if (matchDomain(refererHost, env.BLOCKED_DOMAINS.split(","))) {
                    shouldBlock = true;
                }
            }

            if (shouldBlock) {
                return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
            }
        }
    }

    // ====== 10. 最终写入元数据并返回 ======
    await env.img_url.put(params.id, "", { metadata });
    return response;
}

// ====== 获取 Telegram 文件路径 ======
async function getFilePath(env, file_id) {
    try {
        const apiUrl = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(apiUrl);
        if (!res.ok) return null;
        const json = await res.json();
        return json.ok && json.result ? json.result.file_path : null;
    } catch {
        return null;
    }
}
