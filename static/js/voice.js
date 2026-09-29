(() => {
    "use strict";

    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    let recognition = null;
    let listening = false;
    let speaking = false;
    let voiceOpen = false;

    let voice = null;

    /* =========================================================
       ELEMENTI
    ========================================================= */

    function initElements() {
        voice = {
            screen: document.getElementById("voice"),
            btn: document.getElementById("btn-voice"),
            close: document.getElementById("voice-close"),
            orb: document.getElementById("voice-orb"),
            state: document.getElementById("voice-state"),
            you: document.getElementById("voice-you"),
            cap: document.getElementById("voice-cap"),
            hint: document.getElementById("voice-hint")
        };

        if (!voice.screen) {
            console.error("[JARVIS Voice] Elemento #voice non trovato.");
            return false;
        }

        return true;
    }

    /* =========================================================
       STATO ORB
    ========================================================= */

    function setState(state, label, caption) {
        if (!voice) return;

        voice.orb.dataset.state = state;

        if (label !== undefined) {
            voice.state.textContent = label;
        }

        if (caption !== undefined) {
            voice.cap.textContent = caption;
        }
    }

    /* =========================================================
       APERTURA
    ========================================================= */

    function openVoice() {
        if (!voice) return;

        voiceOpen = true;

        /*
         * IMPORTANTE:
         * il tuo HTML usa class="voice hidden".
         * Quando apriamo la modalità vocale,
         * dobbiamo rimuovere hidden.
         */
        voice.screen.classList.remove("hidden");

        voice.screen.style.display = "grid";

        voice.you.textContent = "";

        if (SpeechRecognition) {
            voice.hint.textContent =
                "Tocca la sfera per iniziare a parlare";
        } else {
            voice.hint.textContent =
                "Il riconoscimento vocale non è supportato da questo browser";
        }

        setState(
            "idle",
            "Pronto",
            "Premi la sfera per parlare"
        );

        requestAnimationFrame(() => {
            voice.screen.style.opacity = "1";
        });
    }

    /* =========================================================
       CHIUSURA
    ========================================================= */

    function closeVoice() {
        if (!voice) return;

        voiceOpen = false;

        stopListening();

        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }

        speaking = false;

        voice.screen.style.opacity = "0";

        setTimeout(() => {
            if (!voiceOpen) {
                voice.screen.classList.add("hidden");
                voice.screen.style.display = "";
            }
        }, 250);
    }

    /* =========================================================
       MICROFONO
    ========================================================= */

    function startListening() {
        if (!voiceOpen) return;

        if (!SpeechRecognition) {
            setState(
                "idle",
                "Non supportato",
                "Il browser non supporta il riconoscimento vocale"
            );

            voice.hint.textContent =
                "Prova Google Chrome o Microsoft Edge";

            return;
        }

        if (listening) {
            stopListening();

            setState(
                "idle",
                "In pausa",
                "Premi la sfera per parlare"
            );

            return;
        }

        /*
         * Se JARVIS sta parlando, interrompiamo la voce
         * prima di iniziare un nuovo ascolto.
         */
        if (window.speechSynthesis) {
            window.speechSynthesis.cancel();
        }

        speaking = false;

        recognition = new SpeechRecognition();

        recognition.lang = "it-IT";
        recognition.continuous = false;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;

        listening = true;

        voice.you.textContent = "";

        setState(
            "listening",
            "In ascolto",
            "Parla con JARVIS..."
        );

        voice.hint.textContent =
            "Sto ascoltando";

        recognition.onresult = (event) => {
            let text = "";

            for (
                let i = event.resultIndex;
                i < event.results.length;
                i++
            ) {
                text += event.results[i][0].transcript;
            }

            text = text.trim();

            voice.you.textContent = text;

            const lastResult =
                event.results[event.results.length - 1];

            if (
                lastResult &&
                lastResult.isFinal &&
                text
            ) {
                stopListening();

                setState(
                    "thinking",
                    "Elaborazione",
                    "JARVIS sta pensando..."
                );

                voice.hint.textContent =
                    "Attendi la risposta";

                /*
                 * Mandiamo il testo ad app.js.
                 */
                window.dispatchEvent(
                    new CustomEvent("jarvis-voice-send", {
                        detail: {
                            text: text
                        }
                    })
                );
            }
        };

        recognition.onerror = (event) => {
            listening = false;

            console.warn(
                "[JARVIS Voice] Errore microfono:",
                event.error
            );

            if (
                event.error === "not-allowed" ||
                event.error === "service-not-allowed"
            ) {
                setState(
                    "idle",
                    "Microfono negato",
                    "Il microfono non è stato autorizzato"
                );

                voice.hint.textContent =
                    "Consenti il microfono nelle impostazioni del browser";

            } else if (event.error === "no-speech") {
                setState(
                    "idle",
                    "Nessuna voce",
                    "Non ho sentito nulla"
                );

                voice.hint.textContent =
                    "Premi la sfera e riprova";

            } else {
                setState(
                    "idle",
                    "Errore",
                    "Problema con il microfono"
                );

                voice.hint.textContent =
                    "Premi la sfera per riprovare";
            }
        };

        recognition.onend = () => {
            listening = false;
            recognition = null;
        };

        try {
            recognition.start();
        } catch (error) {
            console.warn(
                "[JARVIS Voice] Impossibile avviare il microfono:",
                error
            );

            listening = false;
            recognition = null;
        }
    }

    /* =========================================================
       STOP MICROFONO
    ========================================================= */

    function stopListening() {
        if (!recognition) {
            listening = false;
            return;
        }

        try {
            recognition.stop();
        } catch (error) {
            // Il riconoscimento potrebbe essere già terminato.
        }

        recognition = null;
        listening = false;
    }

    /* =========================================================
       SCELTA VOCE
    ========================================================= */

    function chooseVoice() {
        if (!window.speechSynthesis) {
            return null;
        }

        const voices =
            window.speechSynthesis.getVoices();

        if (!voices.length) {
            return null;
        }

        /*
         * Prima cerchiamo una voce italiana.
         */
        const italian = voices.filter((v) => {
            return (
                v.lang &&
                v.lang
                    .toLowerCase()
                    .startsWith("it")
            );
        });

        if (italian.length > 0) {
            return italian.find((v) =>
                /google|italiano|italian|alice|elsa|anna/i.test(
                    v.name
                )
            ) || italian[0];
        }

        /*
         * Se non esiste una voce italiana,
         * usiamo la prima disponibile.
         */
        return voices[0];
    }

    /* =========================================================
       PARLATO
    ========================================================= */

    function speak(text) {
        if (!voiceOpen) return;

        if (!text) return;

        if (!window.speechSynthesis) {
            setState(
                "idle",
                "Pronto",
                "Sintesi vocale non disponibile"
            );

            return;
        }

        window.speechSynthesis.cancel();

        /*
         * Pulizia del testo prima di leggerlo.
         */
        let clean = String(text);

        /*
         * Codice.
         */
        clean = clean.replace(
            /```[\s\S]*?```/g,
            "Ho generato del codice."
        );

        /*
         * Inline code.
         */
        clean = clean.replace(
            /`([^`]+)`/g,
            "$1"
        );

        /*
         * Grassetto.
         */
        clean = clean.replace(
            /\*\*([^*]+)\*\*/g,
            "$1"
        );

        /*
         * Corsivo.
         */
        clean = clean.replace(
            /\*([^*]+)\*/g,
            "$1"
        );

        /*
         * Titoli Markdown.
         */
        clean = clean.replace(
            /#{1,6}\s*/g,
            ""
        );

        /*
         * Eliminiamo alcuni caratteri tipici del Markdown.
         */
        clean = clean.replace(
            /^\s*[-*+]\s+/gm,
            ""
        );

        /*
         * Nuove righe -> spazio.
         */
        clean = clean.replace(
            /\n+/g,
            " "
        );

        clean = clean
            .replace(/\s{2,}/g, " ")
            .trim();

        if (!clean) return;

        const utterance =
            new SpeechSynthesisUtterance(clean);

        utterance.lang = "it-IT";

        /*
         * Velocità della voce.
         */
        utterance.rate = 1;

        /*
         * Altezza.
         */
        utterance.pitch = 1;

        /*
         * Volume.
         */
        utterance.volume = 1;

        const selectedVoice = chooseVoice();

        if (selectedVoice) {
            utterance.voice = selectedVoice;
        }

        utterance.onstart = () => {
            speaking = true;

            setState(
                "speaking",
                "JARVIS",
                "Sto parlando..."
            );

            voice.hint.textContent =
                "Premi la sfera per interrompere";
        };

        utterance.onend = () => {
            speaking = false;

            if (!voiceOpen) return;

            setState(
                "idle",
                "Pronto",
                "Premi la sfera per parlare"
            );

            voice.hint.textContent =
                "Tocca la sfera per iniziare";
        };

        utterance.onerror = (event) => {
            console.warn(
                "[JARVIS Voice] Errore sintesi:",
                event.error
            );

            speaking = false;

            if (!voiceOpen) return;

            setState(
                "idle",
                "Pronto",
                "Premi la sfera per parlare"
            );
        };

        window.speechSynthesis.speak(
            utterance
        );
    }

    /* =========================================================
       JARVIS STA PENSANDO
    ========================================================= */

    function showThinking() {
        if (!voiceOpen) return;

        setState(
            "thinking",
            "Elaborazione",
            "JARVIS sta pensando..."
        );

        voice.hint.textContent =
            "Attendi la risposta";
    }

    /* =========================================================
       ERRORE
    ========================================================= */

    function showError(message) {
        if (!voiceOpen) return;

        setState(
            "idle",
            "Errore",
            message || "Si è verificato un errore."
        );

        voice.hint.textContent =
            "Premi la sfera per riprovare";
    }

    /* =========================================================
       EVENTI
    ========================================================= */

    function init() {
        if (!initElements()) {
            return;
        }

        /*
         * Stato iniziale.
         */
        voice.screen.classList.add("hidden");

        /*
         * Pulsante "Voce" nella barra superiore.
         */
        if (voice.btn) {
            voice.btn.addEventListener(
                "click",
                openVoice
            );
        }

        /*
         * Pulsante X.
         */
        if (voice.close) {
            voice.close.addEventListener(
                "click",
                closeVoice
            );
        }

        /*
         * Orb.
         */
        if (voice.orb) {
            voice.orb.addEventListener(
                "click",
                () => {

                    /*
                     * Se JARVIS sta parlando,
                     * un click interrompe la voce.
                     */
                    if (speaking) {

                        if (
                            window.speechSynthesis
                        ) {
                            window.speechSynthesis.cancel();
                        }

                        speaking = false;

                        setState(
                            "idle",
                            "Pronto",
                            "Premi la sfera per parlare"
                        );

                        voice.hint.textContent =
                            "Tocca la sfera per iniziare";

                        return;
                    }

                    startListening();
                }
            );
        }

        /*
         * ESC per chiudere.
         */
        document.addEventListener(
            "keydown",
            (event) => {
                if (
                    event.key === "Escape" &&
                    voiceOpen
                ) {
                    closeVoice();
                }
            }
        );

        /*
         * JARVIS sta elaborando.
         */
        window.addEventListener(
            "jarvis-voice-thinking",
            showThinking
        );

        /*
         * Risposta arrivata.
         */
        window.addEventListener(
            "jarvis-voice-answer",
            (event) => {
                const text =
                    event.detail?.text || "";

                speak(text);
            }
        );

        /*
         * Errore.
         */
        window.addEventListener(
            "jarvis-voice-error",
            (event) => {
                showError(
                    event.detail?.message
                );
            }
        );

        /*
         * Alcuni browser caricano le voci
         * in modo asincrono.
         */
        if (window.speechSynthesis) {
            window.speechSynthesis.onvoiceschanged =
                () => {
                    chooseVoice();
                };
        }

        console.log(
            "[JARVIS Voice] Modalità vocale pronta."
        );
    }

    /* =========================================================
       API PUBBLICA
    ========================================================= */

    window.JarvisVoice = {
        open: openVoice,
        close: closeVoice,
        speak: speak,
        startListening: startListening,
        stopListening: stopListening,
        setState: setState
    };

    /* =========================================================
       AVVIO
    ========================================================= */

    if (
        document.readyState === "loading"
    ) {
        document.addEventListener(
            "DOMContentLoaded",
            init
        );
    } else {
        init();
    }

})();