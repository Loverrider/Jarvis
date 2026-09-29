(() => {
    "use strict";

    const canvas = document.getElementById("galaxy");
    const ctx = canvas.getContext("2d");
    const aurora = document.getElementById("aurora");
    const cursor = document.getElementById("cursor");

    const reduce =
        window.matchMedia &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0;
    let H = 0;
    let stars = [];
    let nebulae = [];
    let shooters = [];
    let sparks = [];

    const m = { x: 0.5, y: 0.5, tx: 0.5, ty: 0.5, px: -9999, py: -9999 };

    function resize() {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        W = window.innerWidth;
        H = window.innerHeight;

        canvas.width = Math.floor(W * dpr);
        canvas.height = Math.floor(H * dpr);
        canvas.style.width = W + "px";
        canvas.style.height = H + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        const count = W < 700 ? 200 : 460;

        stars = Array.from({ length: count }, () => ({
            x: Math.random(),
            y: Math.random(),
            z: 0.2 + Math.random() * 0.8,
            r: 0.4 + Math.random() * 1.6,
            t: Math.random() * Math.PI * 2,
            s: 0.03 + Math.random() * 0.12,
            d: (Math.random() - 0.5) * 0.1,
            hue: Math.random() < 0.2 ? 200 : 275,
        }));

        const hues = [270, 285, 255, 200, 300];

        nebulae = hues.map((h) => ({
            x: Math.random(),
            y: Math.random(),
            r: 0.25 + Math.random() * 0.3,
            h,
            a: 0.05 + Math.random() * 0.05,
            vx: (Math.random() - 0.5) * 0.00008,
            vy: (Math.random() - 0.5) * 0.00008,
        }));
    }

    window.addEventListener("resize", resize);

    window.addEventListener(
        "pointermove",
        (e) => {
            m.tx = e.clientX / W;
            m.ty = e.clientY / H;
            m.px = e.clientX;
            m.py = e.clientY;
            cursor.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
        },
        { passive: true }
    );

    document.addEventListener("mouseleave", () => {
        m.px = -9999;
        m.py = -9999;
    });

    function burst(x, y, n = 28) {
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2;
            const v = 1 + Math.random() * 4.2;

            sparks.push({
                x,
                y,
                vx: Math.cos(a) * v,
                vy: Math.sin(a) * v - 1,
                life: 1,
                h: Math.random() < 0.3 ? 195 : 280,
            });
        }
    }

    window.JarvisFX = { burst };

    function frame() {
        ctx.clearRect(0, 0, W, H);

        m.x += (m.tx - m.x) * 0.05;
        m.y += (m.ty - m.y) * 0.05;

        aurora.style.setProperty("--mx", m.x * 100 + "%");
        aurora.style.setProperty("--my", m.y * 100 + "%");

        ctx.globalCompositeOperation = "lighter";

        for (const n of nebulae) {
            n.x += n.vx;
            n.y += n.vy;

            if (n.x < -0.2 || n.x > 1.2) n.vx *= -1;
            if (n.y < -0.2 || n.y > 1.2) n.vy *= -1;

            const cx = n.x * W - (m.x - 0.5) * 40;
            const cy = n.y * H - (m.y - 0.5) * 30;
            const r = n.r * Math.max(W, H);

            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
            g.addColorStop(0, `hsla(${n.h}, 90%, 60%, ${n.a})`);
            g.addColorStop(1, `hsla(${n.h}, 90%, 50%, 0)`);

            ctx.fillStyle = g;
            ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
        }

        const near = [];

        for (const s of stars) {
            s.t += 0.02;
            s.y -= s.s / H;
            s.x += s.d / W;

            if (s.y < -0.02) s.y = 1.02;
            if (s.x < -0.02) s.x = 1.02;
            if (s.x > 1.02) s.x = -0.02;

            const x = s.x * W + (m.x - 0.5) * 30 * s.z;
            const y = s.y * H + (m.y - 0.5) * 20 * s.z;
            const a = 0.2 + ((Math.sin(s.t) + 1) / 2) * 0.7 * s.z;

            ctx.beginPath();
            ctx.arc(x, y, s.r * s.z, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${s.hue}, 100%, 88%, ${a})`;
            ctx.fill();

            if (near.length < 40) {
                const dx = x - m.px;
                const dy = y - m.py;
                if (dx * dx + dy * dy < 19600) near.push([x, y]);
            }
        }

        ctx.lineWidth = 0.6;

        for (let i = 0; i < near.length; i++) {
            for (let j = i + 1; j < near.length; j++) {
                const dx = near[i][0] - near[j][0];
                const dy = near[i][1] - near[j][1];
                const d2 = dx * dx + dy * dy;

                if (d2 < 8100) {
                    ctx.strokeStyle = `rgba(190, 130, 255, ${(1 - d2 / 8100) * 0.55})`;
                    ctx.beginPath();
                    ctx.moveTo(near[i][0], near[i][1]);
                    ctx.lineTo(near[j][0], near[j][1]);
                    ctx.stroke();
                }
            }
        }

        if (!reduce && Math.random() < 0.004) {
            shooters.push({
                x: W * (0.3 + Math.random() * 0.7),
                y: Math.random() * H * 0.4,
                vx: -(6 + Math.random() * 6),
                vy: 3 + Math.random() * 4,
                life: 1,
            });
        }

        shooters = shooters.filter((s) => s.life > 0);

        for (const s of shooters) {
            s.x += s.vx;
            s.y += s.vy;
            s.life -= 0.018;

            const tx = s.x - s.vx * 7;
            const ty = s.y - s.vy * 7;

            const g = ctx.createLinearGradient(s.x, s.y, tx, ty);
            g.addColorStop(0, `rgba(255, 240, 255, ${Math.max(s.life, 0)})`);
            g.addColorStop(1, "rgba(180, 100, 255, 0)");

            ctx.strokeStyle = g;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(tx, ty);
            ctx.stroke();
        }

        sparks = sparks.filter((p) => p.life > 0);

        for (const p of sparks) {
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.04;
            p.vx *= 0.985;
            p.life -= 0.02;

            ctx.beginPath();
            ctx.arc(p.x, p.y, 1.2 + Math.max(p.life, 0) * 2, 0, Math.PI * 2);
            ctx.fillStyle = `hsla(${p.h}, 100%, 75%, ${Math.max(p.life, 0)})`;
            ctx.fill();
        }

        ctx.globalCompositeOperation = "source-over";

        requestAnimationFrame(frame);
    }

    resize();
    requestAnimationFrame(frame);
})();