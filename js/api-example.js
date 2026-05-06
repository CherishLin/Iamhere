/**
 * API 接入示例 - 生产环境使用
 *
 * 当前版本使用的是浏览器自带的 Web Speech API 和简单规则匹配的翻译。
 * 如需更好的翻译质量，请参考以下示例接入 AI 服务。
 */

class AIHelper {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.anthropic.com/v1/messages';
    }

    /**
     * 语义优化 - 将口语化中文转为标准表达
     */
    async optimizeText(originalText) {
        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-6',
                    max_tokens: 500,
                    system: `你是中文表达优化专家，服务于出国旅行的中老年用户。

任务：将用户的口语化、碎片化表达，转化为标准、礼貌、完整的中文表达。

规则：
1. 识别用户的真实意图（询问、请求、表达不适等）
2. 去除口语填充词（那个、就是、嗯、啊等）
3. 补全省略的主语、谓语，使句子完整
4. 添加适当的礼貌用语（请、谢谢、您好、不好意思等）
5. 保持原意不变，语气友好得体

输出格式：只返回优化后的中文文本，不要解释、不要引号包裹。`,
                    messages: [{
                        role: 'user',
                        content: `请优化以下表达："${originalText}"`
                    }]
                })
            });

            const data = await response.json();
            return data.content[0].text.trim();
        } catch (error) {
            console.error('语义优化失败:', error);
            return originalText; // 失败时返回原文
        }
    }

    /**
     * 翻译为目标语言
     */
    async translate(optimizedText, targetLang) {
        const langMap = {
            'en-US': '英语',
            'ja-JP': '日语',
            'ko-KR': '韩语',
            'fr-FR': '法语',
            'de-DE': '德语',
            'es-ES': '西班牙语',
            'th-TH': '泰语',
            'vi-VN': '越南语'
        };

        const targetLanguage = langMap[targetLang] || '英语';

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-6',
                    max_tokens: 500,
                    system: `你是专业翻译，将中文翻译为${targetLanguage}。

要求：
1. 翻译自然、地道，符合当地人表达习惯
2. 保持礼貌友好的语气
3. 问句要用正确的疑问句式
4. 请求要用委婉的表达方式
5. 适当考虑文化差异（如西方人不习惯过于客套）

输出格式：只返回翻译结果，不要解释、不要引号包裹。`,
                    messages: [{
                        role: 'user',
                        content: `请翻译成${targetLanguage}："${optimizedText}"`
                    }]
                })
            });

            const data = await response.json();
            return data.content[0].text.trim();
        } catch (error) {
            console.error('翻译失败:', error);
            return `[翻译失败] ${optimizedText}`;
        }
    }

    /**
     * 一步完成优化+翻译（更高效的单次请求）
     */
    async optimizeAndTranslate(originalText, targetLang) {
        const langMap = {
            'en-US': '英语',
            'ja-JP': '日语',
            'ko-KR': '韩语',
            'fr-FR': '法语',
            'de-DE': '德语',
            'es-ES': '西班牙语',
            'th-TH': '泰语',
            'vi-VN': '越南语'
        };

        const targetLanguage = langMap[targetLang] || '英语';

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': this.apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: 'claude-sonnet-4-6',
                    max_tokens: 1000,
                    system: `你是中老年出国旅行者的语音助手。

任务：
1. 先理解用户的口语化中文表达
2. 将其优化为标准、礼貌、完整的中文
3. 再翻译为${targetLanguage}

要求：
- 中文优化要补全省略成分，添加礼貌用语
- 翻译要自然地道，符合当地表达习惯
- 保持友好、礼貌的语气

输出格式（JSON）：
{
    "optimized": "优化后的中文",
    "translated": "翻译结果"
}`,
                    messages: [{
                        role: 'user',
                        content: originalText
                    }]
                })
            });

            const data = await response.json();
            const resultText = data.content[0].text;

            // 解析 JSON 响应
            try {
                const jsonMatch = resultText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    return JSON.parse(jsonMatch[0]);
                }
            } catch (e) {
                console.log('JSON解析失败，尝试文本解析');
            }

            // 备用解析方式
            return {
                optimized: originalText,
                translated: resultText
            };
        } catch (error) {
            console.error('处理失败:', error);
            return {
                optimized: originalText,
                translated: `[处理失败] ${originalText}`
            };
        }
    }
}

/**
 * Google Cloud Translation API 替代方案
 * （成本更低，适合大量翻译）
 */
class GoogleTranslateHelper {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://translation.googleapis.com/language/translate/v2';
    }

    async translate(text, targetLang) {
        // 简化的语言代码
        const langCode = targetLang.split('-')[0];

        try {
            const response = await fetch(`${this.baseUrl}?key=${this.apiKey}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    q: text,
                    target: langCode,
                    format: 'text'
                })
            });

            const data = await response.json();
            return data.data.translations[0].translatedText;
        } catch (error) {
            console.error('Google翻译失败:', error);
            return text;
        }
    }
}

/**
 * 使用示例
 */
async function example() {
    // 初始化 AI 助手
    const ai = new AIHelper('your-anthropic-api-key');

    // 模拟用户说的一句话
    const userSpeech = "那个...我想问问，洗手间...就是厕所，在哪啊？";

    console.log('用户原话:', userSpeech);

    // 方式一：分两步
    const optimized = await ai.optimizeText(userSpeech);
    console.log('优化后:', optimized);
    // 输出: "请问洗手间在哪里？谢谢。"

    const translated = await ai.translate(optimized, 'en-US');
    console.log('翻译结果:', translated);
    // 输出: "Excuse me, where is the restroom? Thank you."

    // 方式二：一步到位（更高效）
    const result = await ai.optimizeAndTranslate(userSpeech, 'en-US');
    console.log('优化:', result.optimized);
    console.log('翻译:', result.translated);
}

// 导出
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { AIHelper, GoogleTranslateHelper };
}
