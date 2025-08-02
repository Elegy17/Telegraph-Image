export async function onRequest(context) {
    const {
        request, // 请求对象
        env,     // 环境变量
        params,  // URL参数
    } = context;

    const url = new URL(request.url);
    const method = request.method;
    
    // 1. 上传限制功能 - 只对POST请求生效
    if (method === "POST") {
        const uploadDomains = env.UPLOAD_DOMAINS;
        
        if (uploadDomains) {
            const domains = uploadDomains.split(",");
            const referer = request.headers.get('Referer');
            
            // 无Referer直接拦截
            if (!referer) {
                return new Response('权限不足', { status: 403 });
            }
            
            try {
                const refererUrl = new URL(referer);
                const refererHost = refererUrl.hostname;
                let isAllowed = false;
                
                // 检查Referer是否在允许的域名列表中
                for (const domain of domains) {
                    // 处理通配符域名 (如 *.example.com)
                    if (domain.startsWith("*.")) {
                        const baseDomain = domain.slice(2);
                        // 匹配主域名和所有子域名
                        if (refererHost === baseDomain || refererHost.endsWith(`.${baseDomain}`)) {
                            isAllowed = true;
                            break;
                        }
                    }
                    // 精确匹配
                    else if (refererHost === domain) {
                        isAllowed = true;
                        break;
                    }
                }
                
                // 不在允许列表中则拦截
                if (!isAllowed) {
                    console.log(`上传请求被阻止: ${refererHost}`);
                    return new Response('权限不足', { status: 403 });
                }
            } catch (e) {
                console.log(`无效的Referer格式: ${referer}`);
                return new Response('权限不足', { status: 403 });
            }
        }
    }
    
    // 2. 双模式防盗链系统
    const HOTLINK_BLOCK_IMAGE = "https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png";
    const HOTLINK_MODE = env.HOTLINK_MODE || "WHITELIST"; // 默认为白名单模式
    
    // 空Referer处理策略 (ALLOW, REDIRECT, BLOCK)
    const EMPTY_REFERER_ACTION = env.EMPTY_REFERER_ACTION || "BLOCK"; // 默认为阻止
    
    // 只处理白名单或黑名单模式
    if (HOTLINK_MODE === "WHITELIST" || HOTLINK_MODE === "BLACKLIST") {
        const referer = request.headers.get('Referer');
        
        // 处理空Referer的情况
        if (!referer) {
            switch(EMPTY_REFERER_ACTION.toUpperCase()) {
                case "ALLOW":
                    console.log("空Referer被允许");
                    break; // 继续处理请求
                    
                case "REDIRECT":
                    console.log("空Referer被重定向到首页");
                    return Response.redirect(url.origin, 302);
                    
                case "BLOCK":
                default:
                    console.log("空Referer被阻止");
                    return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
            }
        } 
        // 处理有Referer的情况
        else {
            try {
                const refererUrl = new URL(referer);
                const refererHost = refererUrl.hostname;
                let shouldBlock = false;
                
                // 白名单模式：只允许列表中的域名
                if (HOTLINK_MODE === "WHITELIST" && env.ALLOWED_DOMAINS) {
                    const allowedDomains = env.ALLOWED_DOMAINS.split(",");
                    let isAllowed = false;
                    
                    for (const domain of allowedDomains) {
                        // 处理通配符域名
                        if (domain.startsWith("*.")) {
                            const baseDomain = domain.slice(2);
                            // 匹配主域名和所有子域名
                            if (refererHost === baseDomain || refererHost.endsWith(`.${baseDomain}`)) {
                                isAllowed = true;
                                break;
                            }
                        }
                        // 精确匹配
                        else if (refererHost === domain) {
                            isAllowed = true;
                            break;
                        }
                    }
                    
                    // 不在白名单中则拦截
                    if (!isAllowed) {
                        console.log(`白名单模式: ${refererHost} 不在允许列表中`);
                        shouldBlock = true;
                    }
                }
                
                // 黑名单模式：只拦截列表中的域名
                if (HOTLINK_MODE === "BLACKLIST" && env.BLOCKED_DOMAINS) {
                    const blockedDomains = env.BLOCKED_DOMAINS.split(",");
                    
                    for (const domain of blockedDomains) {
                        // 处理通配符域名
                        if (domain.startsWith("*.")) {
                            const baseDomain = domain.slice(2);
                            // 匹配主域名和所有子域名
                            if (refererHost === baseDomain || refererHost.endsWith(`.${baseDomain}`)) {
                                console.log(`黑名单模式: ${refererHost} 在阻止列表中`);
                                shouldBlock = true;
                                break;
                            }
                        }
                        // 精确匹配
                        else if (refererHost === domain) {
                            console.log(`黑名单模式: ${refererHost} 在阻止列表中`);
                            shouldBlock = true;
                            break;
                        }
                    }
                }
                
                // 如果需要阻止访问
                if (shouldBlock) {
                    return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
                }
                
            } catch (e) {
                console.log(`无效的Referer格式: ${referer}`);
                return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
            }
        }
    }

    // 3. 图片处理逻辑
    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    
    // 处理Telegram Bot上传的文件
    if (url.pathname.length > 39) {
        const filePath = await getFilePath(env, url.pathname.split(".")[0].split("/")[2]);
        fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
    }

    // 获取图片内容
    console.log(`正在请求图片: ${fileUrl}`);
    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    // 如果请求失败，直接返回响应
    if (!response.ok) {
        console.error(`图片请求失败: ${response.status} ${response.statusText}`);
        return response;
    }

    // 4. 管理员绕过检查
    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) {
        console.log("管理员请求，绕过所有限制");
        return response;
    }

    // 5. KV存储检查
    if (!env.img_url) {
        console.log("KV存储不可用，直接返回图片");
        return response;
    }

    // 6. 元数据处理
    let record = await env.img_url.getWithMetadata(params.id);
    
    // 初始化新记录的元数据
    if (!record || !record.metadata) {
        console.log("未找到元数据，初始化新记录");
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

    // 合并元数据，确保所有字段都有默认值
    const metadata = {
        ListType: record.metadata.ListType || "None",
        Label: record.metadata.Label || "None",
        TimeStamp: record.metadata.TimeStamp || Date.now(),
        liked: record.metadata.liked !== undefined ? record.metadata.liked : false,
        fileName: record.metadata.fileName || params.id,
        fileSize: record.metadata.fileSize || 0,
    };

    // 7. 黑白名单处理
    if (metadata.ListType === "White") {
        console.log("图片在白名单中，允许访问");
        return response;
    } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
        console.log("图片在黑名单中或被标记为成人内容，阻止访问");
        const referer = request.headers.get('Referer');
        const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    // 8. 白名单模式检查（整个图床的维护模式）
    if (env.WhiteList_Mode === "true") {
        console.log("白名单模式已启用，重定向用户");
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    // 9. 内容审核
    if (env.ModerateContentApiKey) {
        try {
            console.log("开始内容审核...");
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
            const moderateResponse = await fetch(moderateUrl);

            if (moderateResponse.ok) {
                const moderateData = await moderateResponse.json();
                console.log("内容审核结果:", moderateData);
                
                // 更新元数据中的标签
                if (moderateData && moderateData.rating_label) {
                    metadata.Label = moderateData.rating_label;
                    
                    // 如果是成人内容，立即阻止访问
                    if (moderateData.rating_label === "adult") {
                        console.log("内容被标记为成人，阻止访问");
                        await env.img_url.put(params.id, "", { metadata });
                        return Response.redirect(`${url.origin}/block-img.html`, 302);
                    }
                }
            } else {
                console.error(`内容审核API请求失败: ${moderateResponse.status}`);
            }
        } catch (error) {
            console.error("内容审核过程中出错:", error);
        }
    }

    // 10. 保存元数据并返回图片
    console.log("保存元数据并返回图片");
    await env.img_url.put(params.id, "", { metadata });
    return response;
}

// 辅助函数：获取Telegram文件路径
async function getFilePath(env, file_id) {
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        console.log(`正在获取文件路径: ${url}`);
        
        const res = await fetch(url, { method: 'GET' });

        if (!res.ok) {
            console.error(`获取文件路径失败: ${res.status}`);
            return null;
        }

        const responseData = await res.json();
        
        // 检查响应是否有效
        if (responseData.ok && responseData.result) {
            console.log(`文件路径获取成功: ${responseData.result.file_path}`);
            return responseData.result.file_path;
        }
        
        console.error("文件路径响应数据无效:", responseData);
        return null;
    } catch (error) {
        console.error("获取文件路径时出错:", error);
        return null;
    }
}
