export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);
    const method = request.method;
    
    // 新增上传限制功能 - 开始
    // 只对上传请求(POST)进行限制
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
                    console.log(`上传请求被阻止: ${refererHost}`);
                    return new Response('权限不足', { status: 403 });
                }
            } catch (e) {
                console.log(`无效的Referer格式: ${referer}`);
                return new Response('权限不足', { status: 403 });
            }
        }
    }
    // 上传限制 - 结束
    
    // 新增防盗链检查 - 开始
    const HOTLINK_BLOCK_IMAGE = "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/私人图床⛔禁止通行.png";
    
    if (env.ALLOWED_DOMAINS) {
        const allowedDomains = env.ALLOWED_DOMAINS.split(",");  
        const referer = request.headers.get('Referer');
        const allowEmptyReferer = env.ALLOW_EMPTY_REFERER === "true";
        
        if (!referer) {
            if (!allowEmptyReferer) {
                console.log("空Referer被阻止");
                return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
            }
        } else {
            try {
                const refererUrl = new URL(referer);
                const refererHost = refererUrl.hostname;
                let isAllowed = false;
                
                for (const domain of allowedDomains) {
                    if (domain.startsWith("*.")) {
                        const baseDomain = domain.slice(2);
                        if (refererHost === baseDomain || refererHost.endsWith(`.${baseDomain}`)) {
                            isAllowed = true;
                            break;
                        }
                    } else if (refererHost === domain) {
                        isAllowed = true;
                        break;
                    }
                }
                
                if (!isAllowed) {
                    console.log(`Referer被阻止: ${refererHost}`);
                    return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
                }
            } catch (e) {
                console.log(`无效的Referer格式: ${referer}`);
                return Response.redirect(HOTLINK_BLOCK_IMAGE, 302);
            }
        }
    }
    // 防盗链检查 - 结束

    // 原始图片处理逻辑
    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    if (url.pathname.length > 39) {
        const filePath = await getFilePath(env, url.pathname.split(".")[0].split("/")[2]);
        fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
    }

    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) return response;

    // 管理员绕过检查
    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) {
        return response;
    }

    // KV存储检查
    if (!env.img_url) {
        return response;
    }

    // 元数据处理
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

    // 黑白名单处理
    if (metadata.ListType === "White") {
        return response;
    } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const referer = request.headers.get('Referer');
        const redirectUrl = referer ? "https://cdn.jsdelivr.net/gh/Elegy17/Git_Image@main/img/私人图床🚫未通过审查.png" : `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    // 白名单模式检查
    if (env.WhiteList_Mode === "true") {
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    // 内容审核
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
            // 错误处理
        }
    }

    // 保存元数据并返回
    await env.img_url.put(params.id, "", { metadata });
    return response;
}

async function getFilePath(env, file_id) {
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
