export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);
    
    // 新增防盗链检查 - 开始
    // 使用更美观的防盗链图片
    const HOTLINK_BLOCK_IMAGE = "https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png";
    
    // 检查是否启用了防盗链
    if (env.ALLOWED_DOMAINS) {
        const allowedDomains = env.ALLOWED_DOMAINS.split(",");
        const referer = request.headers.get('Referer');
        const allowEmptyReferer = env.ALLOW_EMPTY_REFERER === "true";
        
        // 处理空Referer的情况
        if (!referer) {
            // 如果允许空Referer，则继续处理
            if (allowEmptyReferer) {
                console.log("Empty Referer allowed");
            } 
            // 如果不允许空Referer，则拦截
            else {
                console.log("Empty Referer blocked");
                return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
            }
        } 
        // 处理有Referer的情况
        else {
            try {
                const refererUrl = new URL(referer);
                const refererHost = refererUrl.hostname;
                let isAllowed = false;
                
                // 检查Referer是否在允许的域名列表中
                for (const domain of allowedDomains) {
                    // 处理通配符域名 (如 *.example.com)
                    if (domain.startsWith("*.")) {
                        const baseDomain = domain.slice(2); // 移除开头的 "*."
                        // 匹配所有子域名和主域名
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
                
                if (!isAllowed) {
                    console.log(`Referer blocked: ${refererHost}`);
                    return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
                }
            } catch (e) {
                // Referer解析失败视为非法请求
                console.log(`Invalid Referer format: ${referer}`);
                return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
            }
        }
    }
    // 防盗链检查 - 结束

    // 原始图片处理逻辑保持不变
    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    if (url.pathname.length > 39) { // Path length > 39 indicates file uploaded via Telegram Bot API
        const filePath = await getFilePath(env, url.pathname.split(".")[0].split("/")[2]);
        fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
    }

    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    // If the response is OK, proceed with further checks
    if (!response.ok) return response;

    // Allow the admin page to directly view the image
    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) {
        return response;
    }

    // Check if KV storage is available
    if (!env.img_url) {
        return response;  // Directly return image response, terminate execution
    }

    // 原始元数据处理逻辑保持不变
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

    // Handle based on ListType and Label
    if (metadata.ListType === "White") {
        return response;
    } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const referer = request.headers.get('Referer');
        const redirectUrl = referer ? "https://static-res.pages.dev/teleimage/img-block-compressed.png" : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    // Check if WhiteList_Mode is enabled
    if (env.WhiteList_Mode === "true") {
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    // 原始内容审核逻辑保持不变
    if (env.ModerateContentApiKey) {
        try {
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
            const moderateResponse = await fetch(moderateUrl);

            if (moderateResponse.ok) {
                const moderateData = await moderateResponse.json();
                if (moderateData && moderateData.rating_label) {
                    metadata.Label = moderateData.rating_label;
                    if (moderateData.rating_label === "adult") {
                        await env.img_url.put(params.id, "", { metadata });
                        return Response.redirect(`${url.origin}/block-img.html`, 302);
                    }
                }
            }
        } catch (error) {
            // 错误处理保持不变
        }
    }

    // Save metadata and return response
    await env.img_url.put(params.id, "", { metadata });
    return response;
}

async function getFilePath(env, file_id) {
    // 保持不变
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(url, { method: 'GET' });

        if (!res.ok) return null;

        const responseData = await res.json();
        if (responseData.ok && responseData.result) {
            return responseData.result.file_path;
        }
        return null;
    } catch (error) {
        return null;
    }
}
