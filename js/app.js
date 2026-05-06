/**
 * 我在 - 智能语音代说助手
 *
 * 产品定位：极简、温暖、有安全感
 * 适合子女为父母准备的出国旅行助手
 *
 * 核心交互：
 * 1. 首页：按住说话 → 底部三个功能按钮
 * 2. 录音页：正在听你说话 + 实时字幕
 * 3. 处理页：语义整理+翻译
 * 4. 结果页：超大字体 + 自动播放 + 两个操作按钮
 */

class VoiceHelper {
    constructor() {
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.isRecording = false;
        this.autoPlay = true;
        this.currentResult = null;

        // 语言配置
        this.languages = [
            { code: 'en-US', name: '英语', flag: '🇺🇸' },
            { code: 'ja-JP', name: '日语', flag: '🇯🇵' },
            { code: 'ko-KR', name: '韩语', flag: '🇰🇷' },
            { code: 'fr-FR', name: '法语', flag: '🇫🇷' },
            { code: 'de-DE', name: '德语', flag: '🇩🇪' },
            { code: 'es-ES', name: '西班牙语', flag: '🇪🇸' },
            { code: 'th-TH', name: '泰语', flag: '🇹🇭' },
            { code: 'it-IT', name: '意大利语', flag: '🇮🇹' },
        ];

        this.currentLang = this.languages[0];

        this.init();
    }

    init() {
        this.initSpeechRecognition();
        this.bindEvents();
        this.renderLanguageList();

        // 预加载语音
        if (this.synthesis) {
            this.synthesis.getVoices();
        }
    }

    // ========== 语音识别初始化 ==========
    initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.showToast('您的浏览器不支持语音识别，请使用 Chrome 或 Safari');
            return;
        }

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'zh-CN';

        this.recognition.onstart = () => {
            this.isRecording = true;
            this.showPage('listening');
        };

        this.recognition.onresult = (event) => {
            let interim = '';
            let final = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    final += transcript;
                } else {
                    interim += transcript;
                }
            }

            const displayText = final || interim;
            const transcriptEl = document.getElementById('transcript-text');
            if (transcriptEl && displayText) {
                transcriptEl.textContent = displayText;
            }

            if (final) {
                this.finalTranscript = final;
            }
        };

        this.recognition.onerror = (event) => {
            console.error('语音识别错误:', event.error);
            if (event.error === 'not-allowed') {
                this.showToast('请允许使用麦克风权限');
            }
            this.stopRecording();
        };

        this.recognition.onend = () => {
            // 处理最终结果
            if (this.finalTranscript && this.isRecording) {
                const text = this.finalTranscript;
                this.finalTranscript = '';
                this.processVoiceInput(text);
            }
        };
    }

    // ========== 事件绑定 ==========
    bindEvents() {
        const recordBtn = document.getElementById('record-btn');

        // 按住说话 - 支持鼠标和触摸
        const startHandler = (e) => {
            e.preventDefault();
            this.startRecording();
        };

        const endHandler = (e) => {
            e.preventDefault();
            this.stopRecording();
        };

        recordBtn.addEventListener('mousedown', startHandler);
        recordBtn.addEventListener('touchstart', startHandler, { passive: false });

        recordBtn.addEventListener('mouseup', endHandler);
        recordBtn.addEventListener('touchend', endHandler, { passive: false });
        recordBtn.addEventListener('mouseleave', endHandler);

        // 底部功能按钮
        document.getElementById('emergency-btn').addEventListener('click', () => {
            this.openModal('emergency-modal');
        });

        document.getElementById('language-btn').addEventListener('click', () => {
            this.openModal('lang-modal');
        });

        document.getElementById('auto-play-btn').addEventListener('click', () => {
            this.toggleAutoPlay();
        });

        // 紧急求助选项
        document.querySelectorAll('.emergency-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = btn.dataset.text;
                this.closeModal('emergency-modal');
                setTimeout(() => this.processVoiceInput(text), 300);
            });
        });

        // 关闭弹窗
        document.getElementById('close-modal').addEventListener('click', () => {
            this.closeModal('original-modal');
        });

        document.getElementById('close-lang-modal').addEventListener('click', () => {
            this.closeModal('lang-modal');
        });

        document.getElementById('close-emergency-modal').addEventListener('click', () => {
            this.closeModal('emergency-modal');
        });

        // 结果页按钮
        document.getElementById('speak-again-btn').addEventListener('click', () => {
            this.showPage('home');
            // 重置录音按钮状态
            document.getElementById('record-btn').classList.remove('recording');
        });

        document.getElementById('show-original-btn').addEventListener('click', () => {
            this.showOriginalModal();
        });

        // 点击遮罩关闭弹窗
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', () => {
                document.querySelectorAll('.modal').forEach(modal => {
                    modal.classList.remove('active');
                });
            });
        });
    }

    // ========== 录音控制 ==========
    startRecording() {
        if (!this.recognition) {
            this.showToast('您的浏览器不支持语音识别');
            return;
        }

        this.finalTranscript = '';
        document.getElementById('transcript-text').textContent = '';
        document.getElementById('record-btn').classList.add('recording');

        try {
            this.recognition.start();
        } catch (e) {
            // 如果已在运行，先停止
            this.recognition.stop();
            setTimeout(() => this.recognition.start(), 100);
        }
    }

    stopRecording() {
        this.isRecording = false;
        document.getElementById('record-btn').classList.remove('recording');

        try {
            this.recognition.stop();
        } catch (e) {
            // 忽略错误
        }
    }

    // ========== 语音处理 ==========
    async processVoiceInput(text) {
        this.showPage('processing');

        const original = text.trim();

        // 模拟处理步骤
        await this.delay(600);
        document.getElementById('process-step').textContent = '表达优化中...';

        const optimized = this.optimizeText(original);

        await this.delay(600);
        document.getElementById('process-step').textContent = '翻译中...';

        const translated = await this.translateText(optimized, this.currentLang.code);

        await this.delay(400);

        // 保存结果
        this.currentResult = {
            original,
            optimized,
            translated,
            lang: this.currentLang
        };

        // 显示结果
        this.showResult();
    }

    // 语义优化
    optimizeText(text) {
        let optimized = text.trim();

        // 去除多余空格
        optimized = optimized.replace(/\s+/g, ' ');

        // 口语化优化规则
        const rules = [
            { pattern: /那个[呢啥]?|就是[说]?/g, replacement: '' },
            { pattern: /[啊呢吧嘛哦呀]$/g, replacement: '' },
            { pattern: /我想问[一下]?|我想知道[一下]?/g, replacement: '请问' },
            { pattern: /怎么走|怎么过去|怎么去/g, replacement: '如何前往' },
            { pattern: /多少钱|什么价/g, replacement: '价格是多少' },
            { pattern: /我不舒服|我难受|我疼/g, replacement: '我感觉身体不适' },
            { pattern: /帮我[一下]?|给我[弄]?/g, replacement: '请您帮我' },
        ];

        rules.forEach(({ pattern, replacement }) => {
            optimized = optimized.replace(pattern, replacement);
        });

        optimized = optimized.trim();

        // 添加礼貌用语
        if (!optimized.match(/请|谢谢|您好/)) {
            if (optimized.match(/在哪里|多少钱|怎么去/)) {
                optimized = '请问' + optimized;
            }
            if (!optimized.endsWith('谢谢')) {
                optimized += '，谢谢';
            }
        }

        return optimized;
    }

    // 翻译（模拟）
    async translateText(text, targetLang) {
        // 实际项目接入翻译API
        const translations = {
            'en-US': this.translateToEnglish(text),
            'ja-JP': this.translateToJapanese(text),
            'ko-KR': this.translateToKorean(text),
            'fr-FR': this.translateToFrench(text),
            'de-DE': this.translateToGerman(text),
            'es-ES': this.translateToSpanish(text),
            'th-TH': this.translateToThai(text),
            'it-IT': this.translateToItalian(text),
        };

        return translations[targetLang] || text;
    }

    // 简单翻译模板
    translateToEnglish(text) {
        const clean = text.replace('请问', '').replace('，谢谢', '');
        if (text.includes('在哪里')) return `Excuse me, where is ${clean.replace('在哪里', '').trim()}? Thank you.`;
        if (text.includes('多少钱')) return `How much is this? Thank you.`;
        if (text.includes('身体不适')) return `I'm not feeling well and need medical help.`;
        if (text.includes('迷路')) return `I'm lost. Can you help me contact my family?`;
        return `Excuse me, ${clean}. Thank you.`;
    }

    translateToJapanese(text) {
        const clean = text.replace('请问', '').replace('，谢谢', '');
        if (text.includes('在哪里')) return `すみません、${clean.replace('在哪里', 'はどこですか')}。ありがとうございます。`;
        if (text.includes('多少钱')) return `これはいくらですか。ありがとうございます。`;
        return `すみません、${clean}。ありがとうございます。`;
    }

    translateToKorean(text) {
        return `실례합니다, ${text.replace('请问', '').replace('，谢谢', '')}. 감사합니다.`;
    }

    translateToFrench(text) {
        return `Excusez-moi, ${text.replace('请问', '').replace('，谢谢', '')}. Merci.`;
    }

    translateToGerman(text) {
        return `Entschuldigung, ${text.replace('请问', '').replace('，谢谢', '')}. Danke.`;
    }

    translateToSpanish(text) {
        return `Disculpe, ${text.replace('请问', '').replace('，谢谢', '')}. Gracias.`;
    }

    translateToThai(text) {
        return `ขอโทษค่ะ/ครับ, ${text.replace('请问', '').replace('，谢谢', '')}。ขอบคุณค่ะ/ครับ`;
    }

    translateToItalian(text) {
        return `Mi scusi, ${text.replace('请问', '').replace('，谢谢', '')}. Grazie.`;
    }

    // ========== 页面控制 ==========
    showPage(pageName) {
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
        });
        document.getElementById(`page-${pageName}`).classList.add('active');
    }

    // ========== 结果显示 ==========
    showResult() {
        if (!this.currentResult) return;

        document.getElementById('result-flag').textContent = this.currentResult.lang.flag;
        document.getElementById('result-lang').textContent = this.currentResult.lang.name;
        document.getElementById('translation-result').textContent = this.currentResult.translated;

        this.showPage('result');

        // 自动播放
        if (this.autoPlay) {
            this.playTranslation();
        }
    }

    // ========== 语音播放 ==========
    playTranslation() {
        if (!this.currentResult?.translated || !this.synthesis) return;

        this.synthesis.cancel();

        const indicator = document.getElementById('playing-indicator');
        indicator.classList.add('show');

        const utterance = new SpeechSynthesisUtterance(this.currentResult.translated);
        utterance.lang = this.currentResult.lang.code;
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onend = () => {
            indicator.classList.remove('show');
        };

        this.synthesis.speak(utterance);
    }

    // ========== 自动播放开关 ==========
    toggleAutoPlay() {
        this.autoPlay = !this.autoPlay;
        const btn = document.getElementById('auto-play-btn');
        const status = document.getElementById('auto-play-status');

        if (this.autoPlay) {
            btn.classList.add('active');
            status.textContent = '自动语音已开启';
        } else {
            btn.classList.remove('active');
            status.textContent = '自动语音已关闭';
        }
    }

    // ========== 中文原话弹窗 ==========
    showOriginalModal() {
        if (!this.currentResult) return;

        document.getElementById('original-text').textContent = this.currentResult.original;
        document.getElementById('optimized-text').textContent = this.currentResult.optimized;

        this.openModal('original-modal');
    }

    // ========== 语言列表 ==========
    renderLanguageList() {
        const list = document.getElementById('lang-list');
        list.innerHTML = this.languages.map(lang => `
            <div class="lang-item ${lang.code === this.currentLang.code ? 'active' : ''}" data-code="${lang.code}">
                <span class="lang-flag">${lang.flag}</span>
                <span class="lang-name">${lang.name}</span>
            </div>
        `).join('');

        list.querySelectorAll('.lang-item').forEach(item => {
            item.addEventListener('click', () => {
                const code = item.dataset.code;
                this.currentLang = this.languages.find(l => l.code === code);

                // 更新显示
                document.getElementById('current-lang').textContent = `当前语言：${this.currentLang.name}`;

                // 更新选中状态
                list.querySelectorAll('.lang-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                this.closeModal('lang-modal');
            });
        });
    }

    // ========== 弹窗控制 ==========
    openModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    }

    closeModal(modalId) {
        document.getElementById(modalId).classList.remove('active');
    }

    // ========== 工具方法 ==========
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    showToast(message) {
        // 简单的toast提示
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 120px;
            left: 50%;
            transform: translateX(-50%);
            padding: 12px 24px;
            background: rgba(0,0,0,0.8);
            color: white;
            border-radius: 24px;
            font-size: 15px;
            z-index: 1000;
            animation: fadeIn 0.3s;
        `;
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 2500);
    }
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    window.app = new VoiceHelper();
});

// 页面卸载前清理
window.addEventListener('beforeunload', () => {
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
});
