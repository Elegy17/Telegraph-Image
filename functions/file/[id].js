export async function onRequest(context) {
    const { request, env, params } = context;
    const url = new URL(request.url);
    const method = request.method;
    
    // 1. 上传限制功能
    if (method === "POST" && env.UPLOAD_DOMAINS) {
        const domains = env.UPLOAD_DOMAINS.split(",");
        const referer = request.headers.get('Referer');
        
        if (!referer) {
            return new Response('权限不足', { status: 403 });
        }
        
        try {
            const refererUrl = new URL(referer);
            const refererHost = refererUrl.hostname.toLowerCase();
            let isAllowed = false;
            
            for (const domain of domains) {
                const cleanDomain = domain.trim().toLowerCase();
                
                if (cleanDomain.startsWith("*.")) {
                    const baseDomain = cleanDomain.slice(2);
                    if (refererHost === baseDomain || refererHost.endsWith(`.${baseDomain}`)) {
                        isAllowed = true;
                        break;
                    }
                } else if (refererHost === cleanDomain) {
                    isAllowed = true;
                    break;
                }
            }
            
            if (!isAllowed) {
                return new Response('权限不足', { status: 403 });
            }
        } catch (e) {
            return new Response('权限不足', { status: 403 });
        }
    }
    
    // 2. 全局白名单模式检查（最高优先级）
    if (env.WhiteList_Mode === "true") {
        // 管理员绕过检查（放在最前面）
        const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
        if (!isAdmin) {
            return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
        }
    }
    
    // 3. 双模式防盗链系统
    const HOTLINK_MODE = (env.HOTLINK_MODE || "OFF").toUpperCase();
    const HOTLINK_BLOCK_IMAGE = "https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png";
    
    if (HOTLINK_MODE === "WHITELIST" || HOTLINK_MODE === "BLACKLIST") {
        const EMPTY_REFERER_ACTION = (env.EMPTY_REFERER_ACTION || "BLOCK").toUpperCase();
        const referer = request.headers.get('Referer');
        
        // 处理空Referer
        if (!referer) {
            if (EMPTY_REFERER_ACTION === "REDIRECT") {
                return Response.redirect(url.origin, 302);
            } else if (EMPTY_REFERER_ACTION === "BLOCK") {
                return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
            }
        } 
        // 处理有Referer的情况
        else {
            try {
                const refererUrl = new URL(referer);
                const refererHost = refererUrl.hostname.toLowerCase();
                let shouldBlock = false;
                
                // 白名单模式
                if (HOTLINK_MODE === "WHITELIST" && env.ALLOWED_DOMAINS) {
                    const allowedDomains = env.ALLOWED_DOMAINS.split(",");
                    let isAllowed = false;
                    
                    for (const domain of allowedDomains) {
                        const cleanDomain = domain.trim().toLowerCase();
                        
                        if (cleanDomain.startsWith("*.")) {
                            const baseDomain = cleanDomain.slice(2);
                            if (refererHost === baseDomain || refererHost.endsWith(`.${baseDomain}`)) {
                                isAllowed = true;
                                break;
                            }
                        } else if (refererHost === cleanDomain) {
                            isAllowed = true;
                            break;
                        }
                    }
                    
                    if (!isAllowed) shouldBlock = true;
                }
                
                // 黑名单模式
                if (HOTLINK_MODE === "BLACKLIST" && env.BLOCKED_DOMAINS) {
                    const blockedDomains = env.BLOCKED_DOMAINS.split(",");
                    
                    for (const domain of blockedDomains) {
                        const cleanDomain = domain.trim().toLowerCase();
                        
                        if (cleanDomain.startsWith("*.")) {
                            const baseDomain = cleanDomain.slice(2);
                            if (refererHost === baseDomain || refererHost.endsWith(`.${baseDomain}`)) {
                                shouldBlock = true;
                                break;
                            }
                        } else if (refererHost === cleanDomain) {
                            shouldBlock = true;
                            break;
                        }
                    }
                }
                
                if (shouldBlock) {
                    return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
                }
                
            } catch (e) {
                return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
            }
        }
    }

    // 4. 图片处理逻辑
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

    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) return response;

    // 5. 管理员绕过检查（针对内容审核）
    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) return response;

    // 6. KV存储检查
    if (!env.img_url) return response;

    // 7. 元数据处理
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

    // 8. 图片黑白名单处理
    if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const referer = request.headers.get('Referer');
        const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }
    
    // 9. 白名单图片允许访问（放在阻止之后）
    if (metadata.ListType === "White") {
        return response;
    }

    // 10. 内容审核
    if (env.ModerateContentApiKey) {
        try {
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
            const moderateResponse = await fetch(moderateUrl);

            if (moderateResponse.ok) {
                const moderateData = await moderateResponse.json();
                
                if (moderateData && moderateData.rating_label) {
                    metadata.Label = moderateData.rating_label;
                    
                    // 如果是成人内容，立即阻止访问
                    if (moderateData.rating_label === "adult") {
                        await env.img_url.put(params.id, "", { metadata });
                        const referer = request.headers.get('Referer');
                        const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
                        return Response.redirect(redirectUrl, 302);
                    }
                }
            }
        } catch (error) {
            // 静默失败
        }
    }

    // 11. 保存元数据并返回图片
    await env.img_url.put(params.id, "", { metadata });
    return response;
}

// 辅助函数：获取Telegram文件路径
async function getFilePath(env, file_id) {
    try {
        const apiUrl = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(apiUrl, { method: 'GET' });

        if (!res.ok) {
            return null;
        }

        const responseData = await res.json();
        
        if (responseData.ok && responseData.result) {
            return responseData.result.file_path;
        }
        
        return null;
    } catch (error) {
        return null;
    }
}
