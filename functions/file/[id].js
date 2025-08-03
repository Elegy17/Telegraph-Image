export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);
    const method = request.method;
    
    // 0. 常量定义
    const BLOCK_IMAGE = "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/私人图床 🚫 未通过审查.png";
    const BLOCK_PAGE = `${url.origin}/block-img.html`;
    const WAIT_IMAGE = "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/私人图床 ⏳ 审核中.png";  
    const WAIT_PAGE = `${url.origin}/whitelist-on.html`;
    const HOTLINK_BLOCK_IMAGE = "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/私人图床 ⛔ 禁止访问.png";
    const REDIRECT_IMAGE = "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/私人图床 🚧 REDIRECT.png";
    
    // 1. 上传域名验证 (仅POST)
    if (method === "POST" && env.UPLOAD_DOMAINS) {
        const referer = request.headers.get('Referer');
        if (!referer) return new Response('权限不足', { status: 403 });
        
        try {
            const refererHost = new URL(referer).hostname.toLowerCase();
            const domains = env.UPLOAD_DOMAINS.split(",").map(d => d.trim().toLowerCase());
            const isAllowed = domains.some(domain => {
                if (domain.startsWith("*.")) {
                    const base = domain.slice(2);
                    return refererHost === base || refererHost.endsWith(`.${base}`);
                }
                return refererHost === domain;
            });
            
            if (!isAllowed) return new Response('权限不足', { status: 403 });
        } catch (e) {
            return new Response('权限不足', { status: 403 });
        }
    }

    // 2. 构建图片URL
    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    if (url.pathname.length > 39) {
        const fileId = url.pathname.split(".")[0].split("/")[2];
        if (fileId) {
            const filePath = await getFilePath(env, fileId);
            if (filePath) {
                fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
            }
        }
    }

    // 3. 获取源站响应
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });
    if (!response.ok) return response;

    // 4. 管理员绕过检查
    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) return response;

    // 5. 元数据处理
    let record = await env.img_url.getWithMetadata(params.id);
    if (!record || !record.metadata) {
        const initialMetadata = {
            ListType: "None",
            Label: "None",
            TimeStamp: Date.now(),
            liked: false,
            fileName: params.id,
            fileSize: 0,
        };
        await env.img_url.put(params.id, "", { metadata: initialMetadata });
        record = { metadata: initialMetadata };
    }

    const metadata = { ...record.metadata };
    const isBlocked = metadata.ListType === "Block" || metadata.Label === "adult";
    const isWhitelisted = metadata.ListType === "White";

    // 6. 内容拦截检查（最高优先级）
    if (isBlocked) {
        const referer = request.headers.get('Referer');
        return Response.redirect(referer ? BLOCK_IMAGE : BLOCK_PAGE, 302);
    }

    // 7. 全局白名单模式（仅处理未审核内容）
    if (env.WhiteList_Mode === "true" && !isWhitelisted && metadata.ListType === "None") {
        const referer = request.headers.get('Referer');
        return Response.redirect(referer ? WAIT_IMAGE : WAIT_PAGE, 302);
    }

    // 8. 内容审核（仅未审核内容）
    if (env.ModerateContentApiKey && metadata.ListType === "None") {
        try {
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=${encodeURIComponent(fileUrl)}`;
            const res = await fetch(moderateUrl);
            
            if (res.ok) {
                const data = await res.json();
                if (data?.rating_label) {
                    metadata.Label = data.rating_label;
                    await env.img_url.put(params.id, "", { metadata });
                    
                    if (data.rating_label === "adult") {
                        const referer = request.headers.get('Referer');
                        return Response.redirect(referer ? BLOCK_IMAGE : BLOCK_PAGE, 302);
                    }
                }
            }
        } catch (e) {
            // 静默失败
        }
    }

    // 9. 防盗链系统
    const HOTLINK_MODE = (env.HOTLINK_MODE || "WHITELIST").toUpperCase();
    const EMPTY_REFERER_ACTION = (env.EMPTY_REFERER_ACTION || "BLOCK").toUpperCase();
    
    // 9.1 白名单图片绕过防盗链
    if (isWhitelisted) {
        await env.img_url.put(params.id, "", { metadata });
        return response;
    }

    // 9.2 空Referer处理
    const referer = request.headers.get('Referer');
    if (!referer) {
        switch(EMPTY_REFERER_ACTION) {
            case "ALLOW":
                break;
                
            case "REDIRECT":
                // 修复：统一重定向到指定图片，不区分浏览器类型
                return Response.redirect(REDIRECT_IMAGE, 302);
                
            case "BLOCK":
            default:
                return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
        }
    } 
    // 9.3 有Referer的防盗链验证
    else {
        try {
            const refererHost = new URL(referer).hostname.toLowerCase();
            let shouldBlock = false;
            
            // 白名单模式
            if (HOTLINK_MODE === "WHITELIST" && env.ALLOWED_DOMAINS) {
                const allowedDomains = env.ALLOWED_DOMAINS.split(",").map(d => d.trim().toLowerCase());
                const isAllowed = allowedDomains.some(domain => {
                    if (domain.startsWith("*.")) {
                        const base = domain.slice(2);
                        return refererHost === base || refererHost.endsWith(`.${base}`);
                    }
                    return refererHost === domain;
                });
                shouldBlock = !isAllowed;
            }
            // 黑名单模式
            else if (HOTLINK_MODE === "BLACKLIST" && env.BLOCKED_DOMAINS) {
                const blockedDomains = env.BLOCKED_DOMAINS.split(",").map(d => d.trim().toLowerCase());
                shouldBlock = blockedDomains.some(domain => {
                    if (domain.startsWith("*.")) {
                        const base = domain.slice(2);
                        return refererHost === base || refererHost.endsWith(`.${base}`);
                    }
                    return refererHost === domain;
                });
            }
            
            if (shouldBlock) {
                return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
            }
        } catch (e) {
            return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
        }
    }

    // 10. 最终返回
    await env.img_url.put(params.id, "", { metadata });
    return response;
}

// 辅助函数：获取Telegram文件路径
async function getFilePath(env, file_id) {
    try {
        const apiUrl = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(apiUrl);
        
        if (!res.ok) return null;
        const data = await res.json();
        
        return data?.ok ? data.result.file_path : null;
    } catch (error) {
        return null;
    }
}
