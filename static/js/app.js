(() => {
    "use strict";

    const $ = (sel, root = document) => root.querySelector(sel);

    const el = (tag, cls, html) => {
        const node = document.createElement(tag);
        if (cls) node.className = cls;
        if (html !== undefined) node.innerHTML = html;
        return node;
    };

    const app = $("#app");
    const chat = $("#chat");
    const hero = $("#hero");
    const heroInner = $("#hero-inner");
    const input = $("#message");
    const sendBtn = $("#send");
    const orb = $("#orb");
    const convList = $("#conv-list");
    const memList = $("#mem-list");
    const memCount = $("#mem-count");

    const KEY = "jarvis_conv";

    const isTouch = window.matchMedia("(hover: none)").matches;

    const ICON_SEND =
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';
    const ICON_STOP =
        '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';

    const STEPS = [
        ["analysis", "Analisi richiesta"],
        ["retrieval", "Controllo informazioni"],
        ["verify", "Verifica"],
        ["generation", "Generazione"],
    ];

    let convId = Number(localStorage.getItem(KEY)) || null;
    let busy = false;
    let controller = null;
    let stick = true;
    let knownMemIds = new Set();

    /* ---------- utilità ---------- */

    async function api(path, opts) {
        const res = await fetch(path, opts);
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
    }

    function escapeHtml(s) {
        return String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function fmtMs(ms) {
        return ms < 1000 ? ms + " ms" : (ms / 1000).toFixed(1) + " s";
    }

    function toast(text) {
        const t = el("div", "toast");
        t.textContent = text;
        $("#toasts").appendChild(t);
        setTimeout(() => t.classList.add("out"), 3600);
        setTimeout(() => t.remove(), 4100);
    }

    function scrollDown(force) {
        if (force || stick) chat.scrollTop = chat.scrollHeight;
    }

    chat.addEventListener("scroll", () => {
        stick = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 140;
    });

    async function copyText(text) {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return;
            }
        } catch (e) {
            /* fallback sotto */
        }

        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;opacity:0";
        document.body.appendChild(ta);
        ta.select();

        try {
            document.execCommand("copy");
        } catch (e) {
            /* ignora */
        }

        ta.remove();
    }

    document.addEventListener("click", (e) => {
        const btn = e.target.closest(".copy");
        if (!btn) return;

        const code = btn.closest(".code").querySelector("code").textContent;

        copyText(code).then(() => {
            btn.textContent = "Copiato ✓";
            setTimeout(() => (btn.textContent = "Copia"), 1400);
        });
    });

    /* ---------- markdown ---------- */

    function inline(s) {
        const codes = [];

        s = s.replace(/`([^`\n]+)`/g, (m, c) => {
            codes.push(c);
            return "\u0001" + (codes.length - 1) + "\u0001";
        });

        s = escapeHtml(s);
        s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
        s = s.replace(/(^|[^*])\*([^\s*][^*\n]*?)\*(?!\*)/g, "$1<em>$2</em>");
        s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => "<code>" + escapeHtml(codes[Number(i)]) + "</code>");

        return s;
    }

    function codeBlock(block) {
        return (
            '<div class="code"><div class="code-head"><span>' +
            escapeHtml(block.lang) +
            '</span><button class="copy" type="button">Copia</button></div><pre><code>' +
            escapeHtml(block.code) +
            "</code></pre></div>"
        );
    }

    function renderMarkdown(src) {
        const blocks = [];

        const text = String(src).replace(/```([\w+#.-]*)[ \t]*\n?([\s\S]*?)(?:```|$)/g, (m, lang, code) => {
            blocks.push({ lang: lang || "code", code: code.replace(/\n$/, "") });
            return "\n\u0000" + (blocks.length - 1) + "\u0000\n";
        });

        const lines = text.split("\n");
        let html = "";
        let list = null;
        let para = [];

        const flushPara = () => {
            if (para.length) {
                html += "<p>" + para.join("<br>") + "</p>";
                para = [];
            }
        };

        const flushList = () => {
            if (list) {
                html += "</" + list + ">";
                list = null;
            }
        };

        for (const raw of lines) {
            const line = raw.trimEnd();
            let m;

            if (!line.trim()) {
                flushPara();
                flushList();
                continue;
            }

            if ((m = line.match(/^\u0000(\d+)\u0000$/))) {
                flushPara();
                flushList();
                html += codeBlock(blocks[Number(m[1])]);
                continue;
            }

            if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
                flushPara();
                flushList();
                const level = m[1].length + 2;
                html += "<h" + level + ">" + inline(m[2]) + "</h" + level + ">";
                continue;
            }

            if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
                flushPara();
                if (list !== "ul") {
                    flushList();
                    html += "<ul>";
                    list = "ul";
                }
                html += "<li>" + inline(m[1]) + "</li>";
                continue;
            }

            if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
                flushPara();
                if (list !== "ol") {
                    flushList();
                    html += "<ol>";
                    list = "ol";
                }
                html += "<li>" + inline(m[1]) + "</li>";
                continue;
            }

            flushList();
            para.push(inline(line));
        }

        flushPara();
        flushList();

        return html;
    }

    /* ---------- effetti ---------- */

    function scramble(node, finalText) {
        const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&";
        const total = 26;
        let frame = 0;

        const timer = setInterval(() => {
            node.textContent = [...finalText]
                .map((c, i) =>
                    i < (frame / total) * finalText.length
                        ? c
                        : chars[Math.floor(Math.random() * chars.length)]
                )
                .join("");

            frame += 1;

            if (frame > total) {
                clearInterval(timer);
                node.textContent = finalText;
            }
        }, 45);
    }

    if (!isTouch) {
        window.addEventListener("pointermove", (e) => {
            const x = e.clientX / window.innerWidth - 0.5;
            const y = e.clientY / window.innerHeight - 0.5;
            heroInner.style.transform = `rotateY(${x * 14}deg) rotateX(${-y * 14}deg)`;
        });

        document.addEventListener("pointermove", (e) => {
            const target = e.target.closest ? e.target.closest(".glow") : null;
            if (!target) return;

            const r = target.getBoundingClientRect();
            target.style.setProperty("--mx", e.clientX - r.left + "px");
            target.style.setProperty("--my", e.clientY - r.top + "px");
        });
    }

    /* ---------- messaggi ---------- */

    function hideHero() {
        hero.style.display = "none";
    }

    function showHero() {
        hero.style.display = "";
    }

    function clearMessages() {
        chat.querySelectorAll(".msg").forEach((n) => n.remove());
    }

    function addUser(text) {
        hideHero();
        const row = el("div", "msg user");
        const bubble = el("div", "bubble glow");
        bubble.textContent = text;
        row.appendChild(bubble);
        chat.appendChild(row);
    }

    function addJarvis(text) {
        hideHero();
        const row = el("div", "msg jarvis");
        row.appendChild(el("div", "avatar"));

        const stack = el("div", "stack");
        const bubble = el("div", "bubble glow");
        const md = el("div", "md");
        md.innerHTML = renderMarkdown(text);

        bubble.appendChild(md);
        stack.appendChild(bubble);
        row.appendChild(stack);
        chat.appendChild(row);
    }

    function buildThink() {
        const card = el("div", "think collapsed running");

        const head = el("button", "think-head");
        head.type = "button";
        head.innerHTML =
            '<i class="think-state"></i>' +
            '<span class="think-label">Avvio…</span>' +
            '<span class="think-meta"></span>' +
            '<span class="chev">▾</span>';

        const body = el("div", "think-body");
        const list = el("ul", "tsteps");
        const map = {};

        STEPS.forEach(([id, label]) => {
            const li = el("li", "step pending");
            li.dataset.label = label;
            li.innerHTML = '<i class="mk"></i><span class="lbl"></span><span class="ms"></span><span class="det"></span>';
            li.querySelector(".lbl").textContent = label;
            list.appendChild(li);
            map[id] = li;
        });

        const recall = el("div", "recall");

        body.append(list, recall);
        card.append(head, body);

        head.addEventListener("click", () => card.classList.toggle("collapsed"));

        return {
            card,
            map,
            recall,
            label: head.querySelector(".think-label"),
            meta: head.querySelector(".think-meta"),
        };
    }

    function setStep(think, id, state, detail, ms) {
        const s = think.map[id];
        if (!s) return;

        s.className = "step " + state;

        if (detail) s.querySelector(".det").textContent = detail;
        if (typeof ms === "number") s.querySelector(".ms").textContent = fmtMs(ms);

        if (state === "active" && think.card.classList.contains("running")) {
            think.label.textContent = s.dataset.label + "…";
        }
    }

    function renderRecall(think, p) {
        const items = p.items || [];

        think.recall.innerHTML = "";

        if (!items.length && !p.past) return;

        const title = el("div", "recall-title");
        title.textContent = items.length ? "Ricordi utilizzati" : "Riferimenti";
        think.recall.appendChild(title);

        items.forEach((m) => {
            const chip = el("span", "chip");
            chip.textContent = m.content;
            think.recall.appendChild(chip);
        });

        if (p.past) {
            const chip = el("span", "chip alt");
            chip.textContent = p.past + " riferimenti da conversazioni passate";
            think.recall.appendChild(chip);
        }
    }

    function setBusy(value) {
        busy = value;
        sendBtn.classList.toggle("stop", value);
        sendBtn.innerHTML = value ? ICON_STOP : ICON_SEND;
        orb.classList.toggle("thinking", value);
        document.body.classList.toggle("busy", value);
    }

    /* ---------- invio ---------- */

    async function send(text) {
        text = (typeof text === "string" ? text : input.value).trim();
        if (!text || busy) return;

        input.value = "";
        autoResize();
        stick = true;

        const r = sendBtn.getBoundingClientRect();
        if (window.JarvisFX && !isTouch) window.JarvisFX.burst(r.left + r.width / 2, r.top + r.height / 2);

        setBusy(true);
        addUser(text);

        const row = el("div", "msg jarvis");
        row.appendChild(el("div", "avatar"));

        const stack = el("div", "stack");
        const think = buildThink();
        stack.appendChild(think.card);

        const bubble = el("div", "bubble glow hidden");
        const md = el("div", "md");
        bubble.appendChild(md);
        stack.appendChild(bubble);

        row.appendChild(stack);
        chat.appendChild(row);
        scrollDown(true);

        controller = new AbortController();

        let answer = "";
        let started = false;
        let finished = false;
        let raf = 0;

        const t0 = performance.now();

        const tick = setInterval(() => {
            if (!finished) think.meta.textContent = ((performance.now() - t0) / 1000).toFixed(1) + "s";
        }, 200);

        const paint = () => {
            if (raf) return;
            raf = requestAnimationFrame(() => {
                raf = 0;
                md.innerHTML = renderMarkdown(answer);
                scrollDown();
            });
        };

        const showBubble = () => {
            if (!started) {
                started = true;
                bubble.classList.remove("hidden");
            }
        };

        const close = (state) => {
            if (finished) return;
            finished = true;

            bubble.classList.remove("streaming");
            think.card.classList.remove("running");
            think.card.classList.add(state === "done" ? "done" : "failed");

            think.label.textContent =
                state === "done" ? "Ragionamento" : state === "stopped" ? "Interrotto" : "Errore";

            think.meta.textContent = ((performance.now() - t0) / 1000).toFixed(1) + "s";

            Object.values(think.map).forEach((s) => {
                if (s.classList.contains("active")) s.className = "step failed";
            });
        };

        const showError = (message) => {
            showBubble();
            bubble.classList.add("error");
            md.innerHTML = renderMarkdown(answer) + '<p class="err">' + escapeHtml(message) + "</p>";
            scrollDown();
        };

        const onEvent = (p) => {
            switch (p.type) {
                case "init":
                    if (p.conversation_id) {
                        convId = p.conversation_id;
                        localStorage.setItem(KEY, String(convId));
                        if (p.new) loadConversations();
                    }
                    break;

                case "step":
                    setStep(think, p.id, p.state, p.detail, p.ms);
                    break;

                case "memory":
                    renderRecall(think, p);
                    break;

                case "memory_saved":
                    (p.items || []).slice(0, 2).forEach((m) => toast("Memorizzato: " + m.content));
                    loadMemories(false).catch(() => {});
                    break;

                case "chunk":
                    showBubble();
                    bubble.classList.add("streaming");
                    answer += p.content;
                    paint();
                    break;

                case "done":
                    if (typeof p.content === "string" && p.content) answer = p.content;
                    showBubble();
                    if (raf) {
                        cancelAnimationFrame(raf);
                        raf = 0;
                    }
                    md.innerHTML = renderMarkdown(answer);
                    scrollDown();
                    close("done");
                    break;

                case "error":
                    showError(p.message || "Errore durante l'elaborazione.");
                    close("failed");
                    break;

                default:
                    break;
            }
        };

        try {
            const res = await fetch("/chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: text, conversation_id: convId }),
                signal: controller.signal,
            });

            if (!res.ok || !res.body) throw new Error("HTTP " + res.status);

            const reader = res.body.getReader();
            const decoder = new TextDecoder("utf-8");
            let buffer = "";

            for (;;) {
                const { value, done } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });

                const parts = buffer.split("\n\n");
                buffer = parts.pop();

                for (const part of parts) {
                    for (const line of part.split("\n")) {
                        if (!line.startsWith("data:")) continue;

                        let payload;
                        try {
                            payload = JSON.parse(line.slice(5).trim());
                        } catch (e) {
                            continue;
                        }

                        onEvent(payload);
                    }
                }
            }

            if (!finished) {
                if (answer) {
                    md.innerHTML = renderMarkdown(answer);
                    close("done");
                } else {
                    showError("Connessione chiusa senza risposta.");
                    close("failed");
                }
            }
        } catch (err) {
            if (err.name === "AbortError") {
                if (answer) {
                    showBubble();
                    md.innerHTML = renderMarkdown(answer);
                } else {
                    row.remove();
                }
                close("stopped");
            } else {
                console.error(err);
                showError("Non riesco a completare la richiesta. Controlla che il server e Ollama siano avviati.");
                close("failed");
            }
        } finally {
            clearInterval(tick);
            setBusy(false);
            controller = null;
            if (!isTouch) input.focus();
            loadConversations();

            [15000, 40000, 90000].forEach((ms) =>
                setTimeout(() => loadMemories(true).catch(() => {}), ms)
            );
        }
    }

    /* ---------- conversazioni ---------- */

    function resetToHome() {
        convId = null;
        localStorage.removeItem(KEY);
        clearMessages();
        showHero();
        closeDrawers();
        stick = true;
        chat.scrollTop = 0;
        if (!isTouch) input.focus();
    }

    async function removeConversation(id) {
        const current = id === convId;

        if (current && busy && controller) controller.abort();

        try {
            await api("/api/conversations/" + id, { method: "DELETE" });
        } catch (err) {
            console.error(err);
        }

        if (current) resetToHome();

        loadConversations();
    }

    async function loadConversations() {
        try {
            const list = await api("/api/conversations");

            convList.innerHTML = "";

            if (!list.length) {
                convList.appendChild(el("div", "empty", "Nessuna conversazione"));
                return;
            }

            list.forEach((c) => {
                const item = el("div", "conv glow" + (c.id === convId ? " active" : ""));

                const title = el("span", "conv-title");
                title.textContent = c.title;

                const del = el("button", "icon-btn del", "✕");
                del.type = "button";
                del.title = "Elimina";

                del.addEventListener("click", (e) => {
                    e.stopPropagation();
                    removeConversation(c.id);
                });

                item.addEventListener("click", () => openConversation(c.id));
                item.append(title, del);
                convList.appendChild(item);
            });
        } catch (err) {
            console.error(err);
        }
    }

    async function openConversation(id) {
        if (busy) return;

        try {
            const messages = await api("/api/conversations/" + id);

            clearMessages();
            convId = id;
            localStorage.setItem(KEY, String(id));

            if (!messages.length) {
                showHero();
            } else {
                messages.forEach((m) => (m.role === "user" ? addUser(m.content) : addJarvis(m.content)));
            }

            stick = true;
            scrollDown(true);
            closeDrawers();
            loadConversations();
        } catch (err) {
            resetToHome();
            loadConversations();
        }
    }

    function newChat() {
        if (busy) return;

        resetToHome();
        loadConversations();
    }

    /* ---------- memoria ---------- */

    function renderMemories(items, freshIds) {
        memCount.textContent = items.length;
        memList.innerHTML = "";

        if (!items.length) {
            memList.appendChild(el("div", "empty", "Ancora nessun ricordo."));
            return;
        }

        items.forEach((m) => {
            const card = el("div", "mem" + (freshIds.has(m.id) ? " new" : ""));

            const tag = el("span", "tag");
            tag.textContent = m.category;

            const text = el("p");
            text.textContent = m.content;

            const del = el("button", "icon-btn del", "✕");
            del.type = "button";
            del.title = "Dimentica";

            del.addEventListener("click", async () => {
                try {
                    await api("/api/memories/" + m.id, { method: "DELETE" });
                    loadMemories(false);
                } catch (err) {
                    console.error(err);
                }
            });

            card.append(tag, text, del);
            memList.appendChild(card);
        });
    }

    async function loadMemories(notify) {
        const items = await api("/api/memories");

        const fresh = new Set(items.filter((m) => !knownMemIds.has(m.id)).map((m) => m.id));
        const showFresh = notify ? fresh : new Set();

        knownMemIds = new Set(items.map((m) => m.id));
        renderMemories(items, showFresh);

        if (notify) {
            items
                .filter((m) => fresh.has(m.id))
                .slice(0, 2)
                .forEach((m) => toast("Memorizzato: " + m.content));
        }
    }

    $("#mem-form").addEventListener("submit", async (e) => {
        e.preventDefault();

        const field = $("#mem-input");
        const content = field.value.trim();
        if (!content) return;

        try {
            await api("/api/memories", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content }),
            });

            field.value = "";
            await loadMemories(false);
        } catch (err) {
            console.error(err);
        }
    });

    $("#mem-clear").addEventListener("click", async () => {
        if (!confirm("Cancellare tutta la memoria di JARVIS?")) return;

        try {
            await api("/api/memories", { method: "DELETE" });
            await loadMemories(false);
        } catch (err) {
            console.error(err);
        }
    });

    /* ---------- stato server ---------- */

    async function pollHealth() {
        const pill = $("#status");
        const label = $("#status-text");

        try {
            const res = await fetch("/health");
            const data = await res.json();

            if (data.ok && data.model_installed) {
                pill.dataset.state = "online";
                label.textContent = "Online";
            } else if (data.ok) {
                pill.dataset.state = "warn";
                label.textContent = "Modello mancante";
            } else {
                pill.dataset.state = "offline";
                label.textContent = "Ollama offline";
            }
        } catch (err) {
            pill.dataset.state = "offline";
            label.textContent = "Server offline";
        }
    }

    /* ---------- pannelli mobile ---------- */

    function closeDrawers() {
        app.classList.remove("left-open", "right-open");
    }

    $("#btn-left").addEventListener("click", () => {
        app.classList.remove("right-open");
        app.classList.toggle("left-open");
    });

    $("#btn-right").addEventListener("click", () => {
        app.classList.remove("left-open");
        app.classList.toggle("right-open");
    });

    $("#scrim").addEventListener("click", closeDrawers);
    $("#new-chat").addEventListener("click", newChat);

    /* ---------- input ---------- */

    function autoResize() {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 140) + "px";
    }

    input.addEventListener("input", autoResize);

    input.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey && !isTouch) {
            e.preventDefault();
            send();
        }
    });

    sendBtn.addEventListener("click", () => {
        if (busy) {
            if (controller) controller.abort();
        } else {
            send();
        }
    });

    document.querySelectorAll(".suggest .chip").forEach((chip) => {
        chip.addEventListener("click", () => {
            closeDrawers();
            send(chip.dataset.text || chip.textContent);
        });
    });

    /* ---------- avvio ---------- */

    window.addEventListener("load", () => {
        setTimeout(() => {
            const boot = $("#boot");
            boot.classList.add("hide");
            setTimeout(() => boot.remove(), 800);
            scramble($("#hero-title"), "JARVIS");
        }, 1500);
    });

    setBusy(false);
    pollHealth();
    setInterval(pollHealth, 15000);

    loadMemories(false).catch(() => {});
    loadConversations();

    if (convId) openConversation(convId);

    if (!isTouch) input.focus();
})();