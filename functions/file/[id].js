export async function onRequest(context) {
    const {
        request,
        env,
        params,
    } = context;

    const url = new URL(request.url);
    let fileUrl = 'https://telegra.ph/' + url.pathname + url.search
    
    // 处理Telegram Bot API的长路径
    if (url.pathname.length > 39) {
        const formdata = new FormData();
        formdata.append("file_id", url.pathname);

        const requestOptions = {
            method: "POST",
            body: formdata,
            redirect: "follow"
        };
        
        const filePath = await getFilePath(env, url.pathname.split(".")[0].split("/")[2]);
        fileUrl = `https://api.telegram.org/file/bot${env.TG_Bot_Token}/${filePath}`;
    }

    // ================= 新增防盗链检查 =================
    const allowedDomains = env.ALLOWED_DOMAINS;
    const blockImage = "https://gcore.jsdelivr.net/gh/guicaiyue/FigureBed@master/MImg/20240321211254095.png";
    
    if (allowedDomains && allowedDomains.trim() !== "") {
        const domainList = allowedDomains.split(",").map(d => d.trim());
        const referer = request.headers.get('Referer');
        
        // 无Referer或空Referer直接屏蔽
        if (!referer) {
            return Response.redirect(blockImage, 302);
        }
        
        try {
            const refererUrl = new URL(referer);
            // 不在允许域名列表中则屏蔽
            if (!domainList.includes(refererUrl.hostname)) {
                return Response.redirect(blockImage, 302);
            }
        } catch (e) {
            // Referer解析失败也屏蔽
            return Response.redirect(blockImage, 302);
        }
    }
    // ================= 防盗链结束 =================

    const response = await fetch(fileUrl, {
        method: request.method,
        headers: request.headers,
        body: request.body,
    });

    if (!response.ok) return response;

    // 允许admin页面直接查看图片
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
        // 使用新防盗链图片
        return Response.redirect(blockImage, 302);
    }

    // 白名单模式
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
                if (moderateData?.rating_label) {
                    metadata.Label = moderateData.rating_label;

                    if (moderateData.rating_label === "adult") {
                        await env.img_url.put(params.id, "", { metadata });
                        return Response.redirect(blockImage, 302);
                    }
                }
            }
        } catch (error) {
            console.error("Content moderation error:", error);
        }
    }

    // 保存元数据
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
            }
        }
        return null;
    } catch (error) {
        console.error('File path error:', error);
        return null;
    }
}
