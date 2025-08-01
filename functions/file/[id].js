export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);
    
    // 防盗链检查
    const allowedDomains = env.ALLOWED_DOMAINS;
    const allowEmptyReferer = env.ALLOW_EMPTY_REFERER === "true";
    
    if (allowedDomains && allowedDomains.trim() !== "") {
        const domainList = allowedDomains.split(",").map(d => d.trim());
        
        const referer = request.headers.get('Referer');
        console.log(`Referer: ${referer}`);
        
        // 处理无Referer的情况
        if (!referer) {
            if (!allowEmptyReferer) {
                return Response.redirect("https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png", 302);
            }
        } 
        // 处理有Referer但不在白名单的情况
        else {
            try {
                const refererUrl = new URL(referer);
                const refererHost = refererUrl.hostname;
                
                if (!domainList.includes(refererHost)) {
                    return Response.redirect("https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png", 302);
                }
            } catch (e) {
                console.error(`Invalid Referer URL: ${referer}`, e);
                return Response.redirect("https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png", 302);
            }
        }
    }

    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search;
    if (url.pathname.length > 39) {
        console.log(url.pathname.split(".")[0].split("/")[2]);
        const filePath = await getFilePath(env, url.pathname.split(".")[0].split("/")[2]); 
        console.log(filePath);
        fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
    }

    const response = await fetch(fileUrl, { 
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) return response;

    console.log(response.ok, response.status);

    // 管理员直接访问
    const isAdmin = request.headers.get('Referer')?.includes(`${url.origin}/admin`);
    if (isAdmin) {
        return response;
    }

    // KV存储检查
    if (!env.img_url) {
        console.log("KV storage not available, returning image directly");
        return response;
    }

    // 元数据处理
    let record = await env.img_url.getWithMetadata(params.id);
    if (!record || !record.metadata) {
        console.log("Metadata not found, initializing...");
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

    // 内容过滤处理
    if (metadata.ListType === "White") {
        return response;
    } else if (metadata.ListType === "Block" || metadata.Label === "adult") {
        const referer = request.headers.get('Referer');
        // 使用第二张图片作为屏蔽内容显示
        const redirectUrl = referer ? 
            "https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png" : 
            `${url.origin}/block-img.html`;
        return Response.redirect(redirectUrl, 302);
    }

    // 白名单模式
    if (env.WhiteList_Mode === "true") {
        return Response.redirect(`${url.origin}/whitelist-on.html`, 302);
    }

    // 内容审核
    if (env.ModerateContentApiKey) {
        try {
            console.log("Starting content moderation...");
            const moderateUrl = `https://api.moderatecontent.com/moderate/?key=${env.ModerateContentApiKey}&url=https://telegra.ph${url.pathname}${url.search}`;
            const moderateResponse = await fetch(moderateUrl);

            if (moderateResponse.ok) {
                const moderateData = await moderateResponse.json();
                console.log("Content moderation results:", moderateData);

                if (moderateData?.rating_label) {
                    metadata.Label = moderateData.rating_label;

                    if (moderateData.rating_label === "adult") {
                        console.log("Content marked as adult, saving metadata and redirecting");
                        await env.img_url.put(params.id, "", { metadata });
                        // 使用第二张图片作为成人内容屏蔽
                        return Response.redirect(`${url.origin}/block-img.html`, 302);
                    }
                }
            } else {
                console.error("Content moderation API request failed: " + moderateResponse.status);
            }
        } catch (error) {
            console.error("Error during content moderation: " + error.message);
        }
    }

    console.log("Saving metadata");
    await env.img_url.put(params.id, "", { metadata });

    return response;
}

async function getFilePath(env, file_id) {
    try {
        const url = `https://api.telegram.org/bot${env.TG_Bot_Token}/getFile?file_id=${file_id}`;
        const res = await fetch(url, { method: 'GET' });

        if (res.ok) {
            const responseData = await res.json();
            if (responseData.ok && responseData.result) {
                return responseData.result.file_path;
            } else {
                console.error('Error in response data:', responseData);
            }
        } else {
            console.error(`HTTP error! status: ${res.status}`);
        }
    } catch (error) {
        console.error('Error fetching file path:', error.message);
    }
    return null;
}
