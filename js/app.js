/**
 * 我在 - 智能语音代说助手
 *
 * 迭代重点：
 * 1. 语音识别增加主动触发、重试、友好失败页
 * 2. 翻译优先接入专业 API，失败时使用高质量本地兜底
 * 3. 录音中强化状态反馈和实时字幕，降低不确定感
 */

class VoiceHelper {
    constructor() {
        this.recognition = null;
        this.synthesis = window.speechSynthesis;
        this.isRecording = false;
        this.shouldProcessOnEnd = false;
        this.retryCount = 0;
        this.maxAutoRetries = 2;
        this.finalTranscript = '';
        this.interimTranscript = '';
        this.autoPlay = true;
        this.currentResult = null;
        this.currentHearingResult = null;
        this.reverseRecognition = null;
        this.reverseFinalTranscript = '';
        this.reverseInterimTranscript = '';
        this.shouldProcessReverseOnEnd = false;
        this.lastTouchAt = 0;
        this.startAttemptId = 0;
        this.processToken = 0;

        this.languages = [
            { code: 'en-US', deepl: 'EN-US', name: '英语', flag: '🇺🇸' },
            { code: 'ja-JP', deepl: 'JA', name: '日语', flag: '🇯🇵' },
            { code: 'ko-KR', deepl: 'KO', name: '韩语', flag: '🇰🇷' },
            { code: 'fr-FR', deepl: 'FR', name: '法语', flag: '🇫🇷' },
            { code: 'de-DE', deepl: 'DE', name: '德语', flag: '🇩🇪' },
            { code: 'es-ES', deepl: 'ES', name: '西班牙语', flag: '🇪🇸' },
            { code: 'th-TH', deepl: null, name: '泰语', flag: '🇹🇭' },
            { code: 'it-IT', deepl: 'IT', name: '意大利语', flag: '🇮🇹' },
        ];

        this.currentLang = this.languages[0];
        this.translationService = new TranslationService(this.languages);
        this.init();
    }

    init() {
        this.initSpeechRecognition();
        this.bindEvents();
        this.renderLanguageList();

        if (this.synthesis) {
            this.synthesis.getVoices();
        }
    }

    initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'zh-CN';
        this.recognition.maxAlternatives = 3;

        this.recognition.onstart = () => {
            this.isRecording = true;
            this.showPage('listening');
            this.updateTranscript('');
        };

        this.recognition.onresult = (event) => {
            let finalText = '';
            let interimText = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const bestText = this.pickBestRecognitionText(event.results[i]);
                if (event.results[i].isFinal) {
                    finalText += bestText;
                } else {
                    interimText += bestText;
                }
            }

            if (finalText) {
                this.finalTranscript = `${this.finalTranscript}${finalText}`.trim();
            }
            this.interimTranscript = interimText.trim();
            this.updateTranscript(this.finalTranscript || this.interimTranscript);
        };

        this.recognition.onerror = (event) => {
            console.warn('语音识别错误:', event.error);

            if (event.error === 'no-speech') {
                this.retryRecognitionQuietly();
                return;
            }

            if (event.error === 'audio-capture') {
                this.failRecognition('没有检测到麦克风，请确认手机或电脑的麦克风可以使用。');
                return;
            }

            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                this.failRecognition('请允许麦克风权限，然后点“重新说”。');
                return;
            }

            if (event.error === 'network') {
                this.failRecognition('麦克风已打开，但浏览器听写服务暂时连接不上。请再试一次，或先打字让它替您说。');
                return;
            }

            if (event.error === 'aborted') {
                this.failRecognition('刚才被打断了，请点“重新说”。');
                return;
            }

            this.failRecognition('语音识别暂时不可用，请点“重新说”，或先打字让它替您说。');
        };

        this.recognition.onend = () => {
            const text = (this.finalTranscript || this.interimTranscript || '').trim();
            const shouldProcess = this.shouldProcessOnEnd;

            this.isRecording = false;
            this.shouldProcessOnEnd = false;
            document.getElementById('record-btn').classList.remove('recording');

            if (shouldProcess && text) {
                this.retryCount = 0;
                this.processVoiceInput(text);
            } else if (shouldProcess) {
                this.failRecognition('刚才没有听清，请靠近手机，再慢一点说。');
            }
        };
    }

    bindEvents() {
        const recordBtn = document.getElementById('record-btn');
        const startHandler = (e) => {
            e.preventDefault();
            this.prepareRecording();
        };

        recordBtn.addEventListener('click', (e) => {
            if (Date.now() - this.lastTouchAt < 500) return;
            startHandler(e);
        });
        recordBtn.addEventListener('touchstart', (e) => {
            this.lastTouchAt = Date.now();
            startHandler(e);
        }, { passive: false });

        document.getElementById('start-listening-btn').addEventListener('click', () => {
            this.startRecordingWithPermission();
        });

        document.getElementById('cancel-ready-btn').addEventListener('click', () => {
            this.showPage('home');
        });

        document.getElementById('back-home-btn').addEventListener('click', () => {
            this.showPage('home');
        });

        document.querySelectorAll('.page-back').forEach(btn => {
            btn.addEventListener('click', () => {
                this.returnHome();
            });
        });

        document.getElementById('finish-speaking-btn').addEventListener('click', () => {
            this.stopRecording(true);
        });

        document.getElementById('retry-record-btn').addEventListener('click', () => {
            this.prepareRecording(true);
        });

        document.getElementById('fallback-translate-btn').addEventListener('click', () => {
            const text = document.getElementById('fallback-text').value.trim();
            if (!text) {
                document.getElementById('retry-message').textContent = '请先输入想让它替您说的话。';
                return;
            }
            this.processVoiceInput(text);
        });

        document.getElementById('emergency-btn').addEventListener('click', () => {
            this.openModal('emergency-modal');
        });

        document.getElementById('language-btn').addEventListener('click', () => {
            this.openModal('lang-modal');
        });

        document.getElementById('auto-play-btn').addEventListener('click', () => {
            this.toggleAutoPlay();
        });

        document.querySelectorAll('.example-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                const text = chip.dataset.text || chip.textContent;
                this.processVoiceInput(text);
            });
        });

        document.querySelectorAll('.emergency-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const text = btn.dataset.text;
                this.closeModal('emergency-modal');
                setTimeout(() => this.processVoiceInput(text), 300);
            });
        });

        document.getElementById('close-modal').addEventListener('click', () => {
            this.closeModal('original-modal');
        });

        document.getElementById('close-lang-modal').addEventListener('click', () => {
            this.closeModal('lang-modal');
        });

        document.getElementById('close-emergency-modal').addEventListener('click', () => {
            this.closeModal('emergency-modal');
        });

        document.getElementById('speak-again-btn').addEventListener('click', () => {
            this.showPage('home');
            document.getElementById('record-btn').classList.remove('recording');
        });

        document.getElementById('replay-btn').addEventListener('click', () => {
            this.playTranslation();
        });

        document.getElementById('reverse-listen-btn').addEventListener('click', () => {
            this.startReverseListeningWithPermission();
        });

        document.getElementById('show-original-btn').addEventListener('click', () => {
            this.showOriginalModal();
        });

        document.getElementById('finish-hearing-btn').addEventListener('click', () => {
            this.stopReverseListening(true);
        });

        document.getElementById('show-foreign-btn').addEventListener('click', () => {
            this.showForeignModal();
        });

        document.getElementById('replay-hearing-btn').addEventListener('click', () => {
            this.playChineseHearing();
        });

        document.getElementById('hear-again-btn').addEventListener('click', () => {
            this.startReverseListeningWithPermission();
        });

        document.getElementById('close-foreign-modal').addEventListener('click', () => {
            this.closeModal('foreign-modal');
        });

        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', () => {
                document.querySelectorAll('.modal').forEach(modal => {
                    modal.classList.remove('active');
                    modal.setAttribute('aria-hidden', 'true');
                });
            });
        });

        // Keyboard accessibility
        document.addEventListener('keydown', (e) => {
            // Escape to close modals
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal.active').forEach(modal => {
                    modal.classList.remove('active');
                    modal.setAttribute('aria-hidden', 'true');
                });
            }
        });

        // Handle textarea enter key for fallback translation
        const fallbackTextarea = document.getElementById('fallback-text');
        if (fallbackTextarea) {
            fallbackTextarea.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const text = fallbackTextarea.value.trim();
                    if (text) {
                        this.processVoiceInput(text);
                    }
                }
            });
        }
    }

    returnHome() {
        this.processToken += 1;
        this.shouldProcessOnEnd = false;
        this.isRecording = false;
        this.synthesis?.cancel();
        this.stopReverseListening(false);
        document.getElementById('record-btn').classList.remove('recording');
        document.querySelector('#start-listening-btn span').textContent = '开始说话';

        try {
            this.recognition?.stop();
        } catch (error) {
            console.warn('返回时停止识别失败:', error);
        }

        this.showPage('home');
    }

    prepareRecording(fromRetry = false) {
        if (this.isWeChatBrowser()) {
            this.showPage('browser-guide');
            return;
        }

        if (!this.recognition) {
            this.failRecognition('当前浏览器不支持语音识别，请使用 Safari、Chrome 或 Edge。');
            return;
        }

        if (!fromRetry && this.isIOS()) {
            this.showPage('ready');
            return;
        }

        this.startRecordingWithPermission();
    }

    async startRecordingWithPermission() {
        const attemptId = ++this.startAttemptId;
        this.showPage('ready');
        document.querySelector('#start-listening-btn span').textContent = '正在打开麦克风...';

        const permission = await this.ensureMicrophonePermission();
        if (attemptId !== this.startAttemptId) return;

        document.querySelector('#start-listening-btn span').textContent = '开始说话';

        if (!permission.ok) {
            this.failRecognition(permission.message);
            return;
        }

        this.startRecording();
    }

    startRecording() {
        if (!this.recognition) {
            this.failRecognition('当前浏览器不支持语音识别，请使用 Safari、Chrome 或 Edge。');
            return;
        }

        this.finalTranscript = '';
        this.interimTranscript = '';
        this.shouldProcessOnEnd = true;
        this.updateTranscript('');
        document.getElementById('record-btn').classList.add('recording');

        try {
            this.recognition.start();
        } catch (error) {
            try {
                this.recognition.stop();
            } catch (stopError) {
                console.warn('停止识别失败:', stopError);
            }
            setTimeout(() => {
                try {
                    this.recognition.start();
                } catch (restartError) {
                    this.failRecognition('语音识别没有启动成功，请再试一次。');
                }
            }, 220);
        }
    }

    async ensureMicrophonePermission() {
        if (!navigator.mediaDevices?.getUserMedia) {
            return { ok: true };
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            await this.delay(180);
            return { ok: true };
        } catch (error) {
            if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
                return { ok: false, message: '请在浏览器里允许麦克风权限，然后点“重新说”。' };
            }
            if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
                return { ok: false, message: '没有找到麦克风，请确认设备麦克风可以使用。' };
            }
            return { ok: false, message: '麦克风没有打开成功，请检查权限后再试一次。' };
        }
    }

    stopRecording(shouldProcess = true) {
        this.shouldProcessOnEnd = shouldProcess;

        try {
            this.recognition.stop();
        } catch (error) {
            const text = (this.finalTranscript || this.interimTranscript || '').trim();
            this.isRecording = false;
            if (shouldProcess && text) {
                this.processVoiceInput(text);
            } else if (shouldProcess) {
                this.failRecognition('刚才没有听清，请点“重新说”。');
            }
        }
    }

    retryRecognitionQuietly() {
        const heardText = (this.finalTranscript || this.interimTranscript || '').trim();
        if (heardText) {
            this.stopRecording(true);
            return;
        }

        if (this.retryCount < this.maxAutoRetries) {
            this.retryCount += 1;
            this.updateTranscript('');
            setTimeout(() => this.startRecording(), 350);
            return;
        }

        this.failRecognition('刚才没有听清，请靠近手机，再慢一点说。');
    }

    failRecognition(message) {
        this.isRecording = false;
        this.shouldProcessOnEnd = false;
        document.querySelector('#start-listening-btn span').textContent = '开始说话';
        document.getElementById('record-btn').classList.remove('recording');
        document.getElementById('retry-message').textContent = message;
        document.getElementById('fallback-text').value = '';

        try {
            this.recognition?.stop();
        } catch (error) {
            console.warn('停止识别失败:', error);
        }

        this.showPage('retry');
    }

    pickBestRecognitionText(result) {
        const alternatives = Array.from(result);
        const sorted = alternatives.sort((a, b) => b.confidence - a.confidence);
        return (sorted[0]?.transcript || '').trim();
    }

    updateTranscript(text) {
        const transcriptEl = document.getElementById('transcript-text');
        const placeholderEl = document.getElementById('transcript-placeholder');

        transcriptEl.textContent = text;
        placeholderEl.style.display = text ? 'none' : 'block';
    }

    async processVoiceInput(text) {
        const token = ++this.processToken;
        this.showPage('processing');
        document.getElementById('network-hint').textContent = '';
        document.getElementById('process-step').textContent = '正在理解您想表达的意思...';

        const original = text.trim();

        await this.delay(300);
        if (token !== this.processToken) return;
        document.getElementById('process-step').textContent = '正在补全更完整的说法...';

        const optimized = this.translationService.optimizeText(original);

        await this.delay(300);
        if (token !== this.processToken) return;
        document.getElementById('process-step').textContent = '正在整理给对方听的话...';

        const translationResult = await this.translationService.translate(optimized, this.currentLang);
        if (token !== this.processToken) return;

        if (translationResult.fallback) {
            document.getElementById('network-hint').textContent = '网络代说暂时不稳定，已使用常用说法。';
            await this.delay(500);
            if (token !== this.processToken) return;
        }

        this.currentResult = {
            original,
            optimized,
            translated: translationResult.text,
            lang: this.currentLang,
            source: translationResult.source
        };

        this.showResult();
    }

    showPage(pageName) {
        document.querySelectorAll('.page').forEach(page => {
            page.classList.remove('active');
            page.setAttribute('aria-hidden', 'true');
        });
        const targetPage = document.getElementById(`page-${pageName}`);
        targetPage.classList.add('active');
        targetPage.setAttribute('aria-hidden', 'false');

        // Scroll to top for better UX
        targetPage.scrollTop = 0;
    }

    showResult() {
        if (!this.currentResult) return;

        document.getElementById('result-flag').textContent = this.currentResult.lang.flag;
        document.getElementById('result-lang').textContent = this.currentResult.lang.name;
        document.getElementById('translation-result').textContent = this.currentResult.translated;
        document.getElementById('result-note').textContent = this.currentResult.source === 'local-fallback'
            ? '网络代说暂时不稳定，已为您使用常用说法。'
            : '';
        this.updatePlaybackStatus('准备好替您说给对方听', false);

        this.showPage('result');

        if (this.autoPlay) {
            this.playTranslation();
        }
    }

    playTranslation() {
        if (!this.currentResult?.translated || !this.synthesis) return;

        this.synthesis.cancel();

        const indicator = document.getElementById('playing-indicator');
        this.updatePlaybackStatus('正在帮您播放给对方听', true);

        const utterance = new SpeechSynthesisUtterance(this.currentResult.translated);
        utterance.lang = this.currentResult.lang.code;
        utterance.rate = 0.88;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onend = () => {
            this.updatePlaybackStatus('已经帮您说出来了', true);
        };

        utterance.onerror = () => {
            this.updatePlaybackStatus('播放没有成功，请点“再播放一次”', true);
        };

        this.synthesis.speak(utterance);
    }

    updatePlaybackStatus(message, show = true) {
        const indicator = document.getElementById('playing-indicator');
        const status = document.getElementById('playback-status');
        status.textContent = message;
        indicator.classList.toggle('show', show);
    }

    async startReverseListeningWithPermission() {
        if (this.isWeChatBrowser()) {
            this.showPage('browser-guide');
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.failRecognition('当前浏览器不支持听对方说话，请使用 Safari、Chrome 或 Edge。');
            return;
        }

        const permission = await this.ensureMicrophonePermission();
        if (!permission.ok) {
            this.failRecognition(permission.message);
            return;
        }

        this.startReverseListening();
    }

    startReverseListening() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return;

        this.synthesis?.cancel();
        this.reverseFinalTranscript = '';
        this.reverseInterimTranscript = '';
        this.shouldProcessReverseOnEnd = true;
        this.updateForeignTranscript('');

        try {
            this.reverseRecognition?.stop();
        } catch (error) {
            console.warn('停止旧的对方识别失败:', error);
        }

        this.reverseRecognition = new SpeechRecognition();
        this.reverseRecognition.continuous = true;
        this.reverseRecognition.interimResults = true;
        this.reverseRecognition.maxAlternatives = 3;
        this.reverseRecognition.lang = this.currentLang.code;

        this.reverseRecognition.onstart = () => {
            this.showPage('hearing');
            this.updateForeignTranscript('');
        };

        this.reverseRecognition.onresult = (event) => {
            let finalText = '';
            let interimText = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const bestText = this.pickBestRecognitionText(event.results[i]);
                if (event.results[i].isFinal) {
                    finalText += bestText;
                } else {
                    interimText += bestText;
                }
            }

            if (finalText) {
                this.reverseFinalTranscript = `${this.reverseFinalTranscript} ${finalText}`.trim();
            }
            this.reverseInterimTranscript = interimText.trim();
            this.updateForeignTranscript(this.reverseFinalTranscript || this.reverseInterimTranscript);
        };

        this.reverseRecognition.onerror = (event) => {
            console.warn('对方语音识别错误:', event.error);
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                this.failRecognition('请允许麦克风权限，然后再听对方说。');
                return;
            }
            if (event.error === 'network') {
                this.failRecognition('浏览器听写服务暂时连接不上，请稍后再听对方说。');
                return;
            }
            if (event.error !== 'aborted' && event.error !== 'no-speech') {
                this.failRecognition('刚才没有听清对方说话，请靠近一点再试。');
            }
        };

        this.reverseRecognition.onend = () => {
            const text = (this.reverseFinalTranscript || this.reverseInterimTranscript || '').trim();
            const shouldProcess = this.shouldProcessReverseOnEnd;
            this.shouldProcessReverseOnEnd = false;

            if (shouldProcess && text) {
                this.processForeignInput(text);
            } else if (shouldProcess) {
                this.failRecognition('刚才没有听清对方说话，请靠近一点再试。');
            }
        };

        try {
            this.reverseRecognition.start();
        } catch (error) {
            this.failRecognition('听对方说话没有启动成功，请再试一次。');
        }
    }

    stopReverseListening(shouldProcess = true) {
        this.shouldProcessReverseOnEnd = shouldProcess;
        try {
            this.reverseRecognition?.stop();
        } catch (error) {
            console.warn('停止对方识别失败:', error);
        }
    }

    updateForeignTranscript(text) {
        const transcriptEl = document.getElementById('foreign-transcript-text');
        const placeholderEl = document.getElementById('foreign-transcript-placeholder');
        transcriptEl.textContent = text;
        placeholderEl.style.display = text ? 'none' : 'block';
    }

    async processForeignInput(text) {
        const token = ++this.processToken;
        this.showPage('processing');
        document.getElementById('network-hint').textContent = '';
        document.getElementById('process-step').textContent = '正在帮您听懂对方的意思...';

        await this.delay(300);
        if (token !== this.processToken) return;
        document.getElementById('process-step').textContent = '正在整理成中文...';

        const result = await this.translationService.translateToChinese(text, this.currentLang);
        if (token !== this.processToken) return;

        this.currentHearingResult = {
            original: text,
            translated: result.text,
            source: result.source
        };

        document.getElementById('hearing-result-text').textContent = result.text;
        document.getElementById('hearing-note').textContent = result.fallback
            ? '网络听懂暂时不稳定，已根据常见说法帮您判断。'
            : '';

        this.showPage('hearing-result');
        this.playChineseHearing();
    }

    playChineseHearing() {
        if (!this.currentHearingResult?.translated || !this.synthesis) return;
        this.synthesis.cancel();

        const status = document.getElementById('hearing-playback-status');
        const indicator = document.getElementById('hearing-playing-indicator');
        status.textContent = '正在帮您读出来';
        indicator.classList.add('show');

        const utterance = new SpeechSynthesisUtterance(this.currentHearingResult.translated);
        utterance.lang = 'zh-CN';
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onend = () => {
            status.textContent = '已经帮您读出来了';
        };
        utterance.onerror = () => {
            status.textContent = '播放没有成功，请点“再听一遍中文”';
        };

        this.synthesis.speak(utterance);
    }

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

    showOriginalModal() {
        if (!this.currentResult) return;

        document.getElementById('original-text').textContent = this.currentResult.original;
        document.getElementById('optimized-text').textContent = this.currentResult.optimized;

        this.openModal('original-modal');
    }

    showForeignModal() {
        if (!this.currentHearingResult) return;
        document.getElementById('foreign-original-text').textContent = this.currentHearingResult.original;
        this.openModal('foreign-modal');
    }

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
                document.getElementById('current-lang').textContent = `当前语言：${this.currentLang.name}`;
                list.querySelectorAll('.lang-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');
                this.closeModal('lang-modal');
            });
        });
    }

    openModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');

        // Focus management for accessibility
        const closeBtn = modal.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.focus();
        }
    }

    closeModal(modalId) {
        const modal = document.getElementById(modalId);
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
    }

    isWeChatBrowser() {
        return /MicroMessenger/i.test(navigator.userAgent);
    }

    isIOS() {
        return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
            (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

class TranslationService {
    constructor(languages) {
        this.languages = languages;
        this.endpoint = window.WOZAI_TRANSLATE_ENDPOINT || localStorage.getItem('wozaiTranslateEndpoint') || '';
        this.deeplKey = window.DEEPL_AUTH_KEY || localStorage.getItem('deeplAuthKey') || '';
    }

    optimizeText(text) {
        let optimized = this.normalizeSpeechText(text);

        const intentRules = [
            { pattern: /^(厕所|洗手间|卫生间|茅厕|wc)$/i, replacement: '请问洗手间在哪里？谢谢。' },
            { pattern: /^(水|喝水|热水)$/i, replacement: '请问可以给我一杯水吗？谢谢。' },
            { pattern: /^(医院|医生|看病)$/i, replacement: '我身体不舒服，请帮我找医生。谢谢。' },
            { pattern: /^(药|买药|药店)$/i, replacement: '请问附近有药店吗？谢谢。' },
            { pattern: /^(打车|出租车|叫车)$/i, replacement: '请帮我叫一辆出租车。谢谢。' },
            { pattern: /^(机场|去机场)$/i, replacement: '请带我去机场。谢谢。' },
            { pattern: /^(托运|行李托运|怎么办理托运|办理托运)$/i, replacement: '请问在哪里办理行李托运？谢谢。' },
            { pattern: /^(酒店|宾馆|住的地方)$/i, replacement: '请问这家酒店在哪里？谢谢。' },
            { pattern: /^(多少钱|价格|钱)$/i, replacement: '请问这个多少钱？谢谢。' },
            { pattern: /^(菜单|点菜)$/i, replacement: '请给我一份菜单。谢谢。' },
            { pattern: /^(迷路|找不到路)$/i, replacement: '我迷路了，请帮我联系我的家人。谢谢。' },
        ];

        const direct = intentRules.find(rule => rule.pattern.test(optimized));
        if (direct) return direct.replacement;

        const rules = [
            { pattern: /那个|这个|就是|然后|嗯+|呃+|啊+|呀+|嘛+|呢+/g, replacement: '' },
            { pattern: /我想问一下|我想问问|我想知道一下|问一下/g, replacement: '请问' },
            { pattern: /厕所|卫生间|茅厕|wc/gi, replacement: '洗手间' },
            { pattern: /哪儿|哪里|在哪儿|在哪/g, replacement: '在哪里' },
            { pattern: /怎么走|怎么过去|怎么去/g, replacement: '如何前往' },
            { pattern: /多少钱|什么价|咋卖/g, replacement: '价格是多少' },
            { pattern: /我不舒服|我难受|我疼|不太舒服/g, replacement: '我感觉身体不适' },
            { pattern: /帮我一下|帮我|给我弄一下/g, replacement: '请您帮我' },
        ];

        rules.forEach(({ pattern, replacement }) => {
            optimized = optimized.replace(pattern, replacement);
        });

        optimized = optimized.replace(/\s+/g, ' ').trim();

        if (!optimized) return text.trim();
        if (!/[。！？?]$/.test(optimized)) optimized += '。';
        if (!/请|谢谢|您好|不好意思/.test(optimized)) {
            optimized = `您好，${optimized.replace(/^我想/, '我想')}`;
        }
        if (!/谢谢/.test(optimized)) {
            optimized = optimized.replace(/[。！？?]$/, '，谢谢。');
        }

        return optimized;
    }

    normalizeSpeechText(text) {
        return text
            .replace(/[，。！？、,.!?]/g, '')
            .replace(/\s+/g, '')
            .trim();
    }

    async translate(text, lang) {
        const apiResult = await this.translateWithConfiguredApi(text, lang);
        if (apiResult) return apiResult;

        const deeplResult = await this.translateWithDeepL(text, lang);
        if (deeplResult) return deeplResult;

        return {
            text: this.fallbackTranslate(text, lang.code),
            source: 'local-fallback',
            fallback: true
        };
    }

    async translateWithConfiguredApi(text, lang) {
        if (!this.endpoint) return null;

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    source: 'zh-CN',
                    target: lang.code,
                    targetName: lang.name
                })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const translated = data.translated || data.translation || data.text;
            const optimized = data.optimized || text;

            if (translated) {
                return {
                    text: String(translated).trim(),
                    optimized,
                    source: 'configured-api',
                    fallback: false
                };
            }
        } catch (error) {
            console.warn('配置翻译 API 失败:', error);
        }

        return null;
    }

    async translateWithDeepL(text, lang) {
        if (!this.deeplKey || !lang.deepl) return null;

        try {
            const body = new URLSearchParams({
                text,
                source_lang: 'ZH',
                target_lang: lang.deepl
            });

            const response = await fetch('https://api-free.deepl.com/v2/translate', {
                method: 'POST',
                headers: {
                    Authorization: `DeepL-Auth-Key ${this.deeplKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const translated = data.translations?.[0]?.text;

            if (translated) {
                return {
                    text: translated.trim(),
                    source: 'deepl',
                    fallback: false
                };
            }
        } catch (error) {
            console.warn('DeepL 翻译失败:', error);
        }

        return null;
    }

    async translateToChinese(text, sourceLang) {
        const apiResult = await this.translateToChineseWithConfiguredApi(text, sourceLang);
        if (apiResult) return apiResult;

        const deeplResult = await this.translateToChineseWithDeepL(text, sourceLang);
        if (deeplResult) return deeplResult;

        return {
            text: this.fallbackToChinese(text),
            source: 'local-fallback',
            fallback: true
        };
    }

    async translateToChineseWithConfiguredApi(text, sourceLang) {
        if (!this.endpoint) return null;

        try {
            const response = await fetch(this.endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    source: sourceLang.code,
                    sourceName: sourceLang.name,
                    target: 'zh-CN',
                    targetName: '中文'
                })
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const translated = data.translated || data.translation || data.text;

            if (translated) {
                return {
                    text: String(translated).trim(),
                    source: 'configured-api',
                    fallback: false
                };
            }
        } catch (error) {
            console.warn('配置中文理解 API 失败:', error);
        }

        return null;
    }

    async translateToChineseWithDeepL(text, sourceLang) {
        if (!this.deeplKey) return null;

        try {
            const body = new URLSearchParams({
                text,
                target_lang: 'ZH'
            });
            if (sourceLang.deepl) {
                body.set('source_lang', sourceLang.deepl.split('-')[0]);
            }

            const response = await fetch('https://api-free.deepl.com/v2/translate', {
                method: 'POST',
                headers: {
                    Authorization: `DeepL-Auth-Key ${this.deeplKey}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body
            });

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const translated = data.translations?.[0]?.text;

            if (translated) {
                return {
                    text: translated.trim(),
                    source: 'deepl',
                    fallback: false
                };
            }
        } catch (error) {
            console.warn('DeepL 中文理解失败:', error);
        }

        return null;
    }

    fallbackToChinese(text) {
        const normalized = text.toLowerCase();
        const checks = [
            { pattern: /restroom|bathroom|toilet|washroom|toilettes|baño|bagno|トイレ|화장실/, text: '对方可能在说：洗手间。' },
            { pattern: /how much|price|cost|combien|cuánto|quanto|いくら|얼마/, text: '对方可能在问：多少钱或价格是多少。' },
            { pattern: /luggage|baggage|check in|bagage|equipaje|bagaglio|荷物|수하물/, text: '对方可能在说：行李托运或办理手续。' },
            { pattern: /passport|护照|パスポート|여권/, text: '对方可能在说：请出示护照。' },
            { pattern: /ticket|boarding pass|billet|boleto|biglietto|チケット|탑승권/, text: '对方可能在说：票或登机牌。' },
            { pattern: /wait|moment|minute|attendez|espere|aspetti|待って|기다/, text: '对方可能在说：请稍等。' },
            { pattern: /left|right|straight|gauche|droite|izquierda|derecha|左|右/, text: '对方可能在指路。' },
        ];

        const match = checks.find(item => item.pattern.test(normalized));
        if (match) return match.text;
        return `我听到对方说：“${text}”。这句话需要联网后才能更准确地帮您说成中文。`;
    }

    fallbackTranslate(text, targetLang) {
        const intent = this.detectIntent(text);
        const table = this.intentTranslations[intent] || this.intentTranslations.generic;
        return table[targetLang] || table['en-US'];
    }

    detectIntent(text) {
        const checks = [
            ['restroom', /洗手间|厕所|卫生间/],
            ['water', /水|热水/],
            ['doctor', /身体不适|医生|医院|看病|难受|疼/],
            ['pharmacy', /药店|买药|药/],
            ['taxi', /出租车|打车|叫车/],
            ['airport', /机场/],
            ['baggage', /托运|行李/],
            ['hotel', /酒店|宾馆|入住/],
            ['price', /价格|多少钱/],
            ['menu', /菜单|点菜/],
            ['lost', /迷路|联系我的家人|找不到路/],
            ['police', /报警|警察|需要帮助/],
            ['lostItem', /东西丢了|物品丢失|找找/],
        ];

        const match = checks.find(([, pattern]) => pattern.test(text));
        return match ? match[0] : 'generic';
    }

    get intentTranslations() {
        return {
            restroom: {
                'en-US': 'Excuse me, where is the restroom? Thank you.',
                'ja-JP': 'すみません、トイレはどこですか。ありがとうございます。',
                'ko-KR': '실례합니다. 화장실이 어디에 있나요? 감사합니다.',
                'fr-FR': 'Excusez-moi, où sont les toilettes ? Merci.',
                'de-DE': 'Entschuldigung, wo ist die Toilette? Danke.',
                'es-ES': 'Disculpe, ¿dónde está el baño? Gracias.',
                'th-TH': 'ขอโทษครับ/ค่ะ ห้องน้ำอยู่ที่ไหน ขอบคุณครับ/ค่ะ',
                'it-IT': 'Mi scusi, dov’è il bagno? Grazie.'
            },
            water: {
                'en-US': 'Excuse me, could I have a glass of water, please? Thank you.',
                'ja-JP': 'すみません、お水を一杯いただけますか。ありがとうございます。',
                'ko-KR': '실례합니다. 물 한 잔 주실 수 있나요? 감사합니다.',
                'fr-FR': 'Excusez-moi, pourrais-je avoir un verre d’eau, s’il vous plaît ? Merci.',
                'de-DE': 'Entschuldigung, könnte ich bitte ein Glas Wasser bekommen? Danke.',
                'es-ES': 'Disculpe, ¿podría darme un vaso de agua, por favor? Gracias.',
                'th-TH': 'ขอโทษครับ/ค่ะ ขอชั้นน้ำหนึ่งแก้วได้ไหม ขอบคุณครับ/ค่ะ',
                'it-IT': 'Mi scusi, potrei avere un bicchiere d’acqua, per favore? Grazie.'
            },
            doctor: {
                'en-US': 'I am not feeling well. Could you please help me find a doctor?',
                'ja-JP': '体調がよくありません。医師を探すのを手伝っていただけますか。',
                'ko-KR': '몸이 좋지 않습니다. 의사를 찾는 것을 도와주실 수 있나요?',
                'fr-FR': 'Je ne me sens pas bien. Pourriez-vous m’aider à trouver un médecin ?',
                'de-DE': 'Mir geht es nicht gut. Können Sie mir bitte helfen, einen Arzt zu finden?',
                'es-ES': 'No me siento bien. ¿Podría ayudarme a encontrar un médico?',
                'th-TH': 'ฉันรู้สึกไม่สบาย ช่วยพาไปพบแพทย์ได้ไหม',
                'it-IT': 'Non mi sento bene. Potrebbe aiutarmi a trovare un medico?'
            },
            pharmacy: {
                'en-US': 'Excuse me, is there a pharmacy nearby? Thank you.',
                'ja-JP': 'すみません、近くに薬局はありますか。ありがとうございます。',
                'ko-KR': '실례합니다. 근처에 약국이 있나요? 감사합니다.',
                'fr-FR': 'Excusez-moi, y a-t-il une pharmacie près d’ici ? Merci.',
                'de-DE': 'Entschuldigung, gibt es hier in der Nähe eine Apotheke? Danke.',
                'es-ES': 'Disculpe, ¿hay una farmacia cerca? Gracias.',
                'th-TH': 'ขอโทษครับ/ค่ะ แถวนี้มีร้านขายยาไหม ขอบคุณครับ/ค่ะ',
                'it-IT': 'Mi scusi, c’è una farmacia qui vicino? Grazie.'
            },
            taxi: {
                'en-US': 'Could you please help me call a taxi? Thank you.',
                'ja-JP': 'タクシーを呼ぶのを手伝っていただけますか。ありがとうございます。',
                'ko-KR': '택시를 불러 주실 수 있나요? 감사합니다.',
                'fr-FR': 'Pourriez-vous m’aider à appeler un taxi ? Merci.',
                'de-DE': 'Könnten Sie mir bitte helfen, ein Taxi zu rufen? Danke.',
                'es-ES': '¿Podría ayudarme a pedir un taxi? Gracias.',
                'th-TH': 'ช่วยเรียกแท็กซี่ให้ฉันได้ไหม ขอบคุณครับ/ค่ะ',
                'it-IT': 'Potrebbe aiutarmi a chiamare un taxi? Grazie.'
            },
            airport: {
                'en-US': 'Please take me to the airport. Thank you.',
                'ja-JP': '空港まで連れて行ってください。ありがとうございます。',
                'ko-KR': '공항으로 가 주세요. 감사합니다.',
                'fr-FR': 'Veuillez m’emmener à l’aéroport, s’il vous plaît. Merci.',
                'de-DE': 'Bitte bringen Sie mich zum Flughafen. Danke.',
                'es-ES': 'Por favor, lléveme al aeropuerto. Gracias.',
                'th-TH': 'กรุณาพาฉันไปสนามบิน ขอบคุณครับ/ค่ะ',
                'it-IT': 'Per favore, mi porti all’aeroporto. Grazie.'
            },
            baggage: {
                'en-US': 'Excuse me, where can I check in my luggage? Thank you.',
                'ja-JP': 'すみません、荷物の預け入れはどこでできますか。ありがとうございます。',
                'ko-KR': '실례합니다. 수하물은 어디에서 부칠 수 있나요? 감사합니다.',
                'fr-FR': 'Excusez-moi, où puis-je enregistrer mes bagages ? Merci.',
                'de-DE': 'Entschuldigung, wo kann ich mein Gepäck aufgeben? Danke.',
                'es-ES': 'Disculpe, ¿dónde puedo facturar mi equipaje? Gracias.',
                'th-TH': 'ขอโทษครับ/ค่ะ ฉันจะเช็กอินกระเป๋าได้ที่ไหน ขอบคุณครับ/ค่ะ',
                'it-IT': 'Mi scusi, dove posso imbarcare il bagaglio? Grazie.'
            },
            hotel: {
                'en-US': 'Excuse me, where is this hotel? Thank you.',
                'ja-JP': 'すみません、このホテルはどこですか。ありがとうございます。',
                'ko-KR': '실례합니다. 이 호텔이 어디에 있나요? 감사합니다.',
                'fr-FR': 'Excusez-moi, où se trouve cet hôtel ? Merci.',
                'de-DE': 'Entschuldigung, wo ist dieses Hotel? Danke.',
                'es-ES': 'Disculpe, ¿dónde está este hotel? Gracias.',
                'th-TH': 'ขอโทษครับ/ค่ะ โรงแรมนี้อยู่ที่ไหน ขอบคุณครับ/ค่ะ',
                'it-IT': 'Mi scusi, dov’è questo hotel? Grazie.'
            },
            price: {
                'en-US': 'Excuse me, how much is this? Thank you.',
                'ja-JP': 'すみません、これはいくらですか。ありがとうございます。',
                'ko-KR': '실례합니다. 이것은 얼마인가요? 감사합니다.',
                'fr-FR': 'Excusez-moi, combien ça coûte ? Merci.',
                'de-DE': 'Entschuldigung, wie viel kostet das? Danke.',
                'es-ES': 'Disculpe, ¿cuánto cuesta esto? Gracias.',
                'th-TH': 'ขอโทษครับ/ค่ะ อันนี้ราคาเท่าไร ขอบคุณครับ/ค่ะ',
                'it-IT': 'Mi scusi, quanto costa questo? Grazie.'
            },
            menu: {
                'en-US': 'Could I have a menu, please? Thank you.',
                'ja-JP': 'メニューをいただけますか。ありがとうございます。',
                'ko-KR': '메뉴를 주실 수 있나요? 감사합니다.',
                'fr-FR': 'Puis-je avoir un menu, s’il vous plaît ? Merci.',
                'de-DE': 'Könnte ich bitte eine Speisekarte bekommen? Danke.',
                'es-ES': '¿Podría darme un menú, por favor? Gracias.',
                'th-TH': 'ขอเมนูได้ไหม ขอบคุณครับ/ค่ะ',
                'it-IT': 'Potrei avere un menu, per favore? Grazie.'
            },
            lost: {
                'en-US': 'I am lost. Could you please help me contact my family?',
                'ja-JP': '道に迷いました。家族に連絡するのを手伝っていただけますか。',
                'ko-KR': '길을 잃었습니다. 가족에게 연락하는 것을 도와주실 수 있나요?',
                'fr-FR': 'Je suis perdu(e). Pourriez-vous m’aider à contacter ma famille ?',
                'de-DE': 'Ich habe mich verlaufen. Können Sie mir bitte helfen, meine Familie zu kontaktieren?',
                'es-ES': 'Estoy perdido/a. ¿Podría ayudarme a contactar a mi familia?',
                'th-TH': 'ฉันหลงทาง ช่วยติดต่อครอบครัวให้ฉันได้ไหม',
                'it-IT': 'Mi sono perso/a. Potrebbe aiutarmi a contattare la mia famiglia?'
            },
            police: {
                'en-US': 'Please help me call the police. I need help.',
                'ja-JP': '警察を呼ぶのを手伝ってください。助けが必要です。',
                'ko-KR': '경찰에 신고해 주세요. 도움이 필요합니다.',
                'fr-FR': 'Aidez-moi à appeler la police, s’il vous plaît. J’ai besoin d’aide.',
                'de-DE': 'Bitte helfen Sie mir, die Polizei zu rufen. Ich brauche Hilfe.',
                'es-ES': 'Por favor, ayúdeme a llamar a la policía. Necesito ayuda.',
                'th-TH': 'กรุณาช่วยโทรแจ้งตำรวจ ฉันต้องการความช่วยเหลือ',
                'it-IT': 'Per favore, mi aiuti a chiamare la polizia. Ho bisogno di aiuto.'
            },
            lostItem: {
                'en-US': 'I lost my belongings. Could you please help me look for them?',
                'ja-JP': '持ち物をなくしました。探すのを手伝っていただけますか。',
                'ko-KR': '물건을 잃어버렸습니다. 찾는 것을 도와주실 수 있나요?',
                'fr-FR': 'J’ai perdu mes affaires. Pourriez-vous m’aider à les chercher ?',
                'de-DE': 'Ich habe meine Sachen verloren. Können Sie mir bitte beim Suchen helfen?',
                'es-ES': 'Perdí mis cosas. ¿Podría ayudarme a buscarlas?',
                'th-TH': 'ของของฉันหาย ช่วยฉันหาได้ไหม',
                'it-IT': 'Ho perso le mie cose. Potrebbe aiutarmi a cercarle?'
            },
            generic: {
                'en-US': 'Excuse me, could you please help me with this? Thank you.',
                'ja-JP': 'すみません、これを手伝っていただけますか。ありがとうございます。',
                'ko-KR': '실례합니다. 이것을 도와주실 수 있나요? 감사합니다.',
                'fr-FR': 'Excusez-moi, pourriez-vous m’aider avec cela ? Merci.',
                'de-DE': 'Entschuldigung, könnten Sie mir bitte dabei helfen? Danke.',
                'es-ES': 'Disculpe, ¿podría ayudarme con esto? Gracias.',
                'th-TH': 'ขอโทษครับ/ค่ะ ช่วยฉันเรื่องนี้ได้ไหม ขอบคุณครับ/ค่ะ',
                'it-IT': 'Mi scusi, potrebbe aiutarmi con questo? Grazie.'
            }
        };
    }
}

// Loading screen management
function hideLoadingScreen() {
    const loadingScreen = document.getElementById('loading-screen');
    if (loadingScreen) {
        loadingScreen.classList.add('hidden');
        setTimeout(() => {
            loadingScreen.style.display = 'none';
        }, 500);
    }
}

// Show loading screen for a minimum time then hide
window.addEventListener('load', () => {
    setTimeout(hideLoadingScreen, 1200);
});

// Fallback: hide loading screen after 3 seconds even if load event doesn't fire
setTimeout(hideLoadingScreen, 3000);

document.addEventListener('DOMContentLoaded', () => {
    window.app = new VoiceHelper();
});

window.addEventListener('beforeunload', () => {
    if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
    }
});
