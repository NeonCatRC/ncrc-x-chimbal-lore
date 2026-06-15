"use strict";

/* starfield.jsx — компонент Starfield (фоновый canvas архива)
 *
 * Спокойное звёздное поле с дрейфом вниз + зелёные неон-метеоры. Перенесено
 * один-в-один из startStarfield() монолита. Параметров нет — вид фиксированный
 * под акцент архива (#39ff8b). Логика анимации крутится в useEffect, чистится
 * при размонтировании. Регистрируется как window.Starfield (см. js/archive.jsx).
 */
function Starfield() {
  const canvasRef = React.useRef(null);
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let W = 0,
      H = 0,
      DPR = 1,
      raf;
    const accent = [57, 255, 139];
    const accent2 = [31, 217, 122];
    const speed = 0.6;
    let field = [],
      meteors = [];
    const spawnMeteor = initial => {
      const fromTop = Math.random() > 0.35;
      return {
        x: fromTop ? Math.random() * W * 1.1 : W + Math.random() * 200,
        y: fromTop ? -Math.random() * 220 : Math.random() * H * 0.6,
        len: 110 + Math.random() * 200,
        sp: (5 + Math.random() * 7) * speed,
        delay: initial ? Math.random() * 180 : Math.random() * 140 + 20
      };
    };
    const init = () => {
      const layers = [{
        n: W * H / 4200,
        sp: 0.05,
        r: [0.4, 1.0]
      }, {
        n: W * H / 6500,
        sp: 0.12,
        r: [0.7, 1.5]
      }, {
        n: W * H / 11000,
        sp: 0.22,
        r: [1.1, 2.2]
      }];
      field = [];
      layers.forEach(L => {
        for (let i = 0; i < Math.floor(L.n); i++) {
          field.push({
            x: Math.random() * W,
            y: Math.random() * H,
            r: L.r[0] + Math.random() * (L.r[1] - L.r[0]),
            sp: L.sp,
            tw: Math.random() * Math.PI * 2,
            tws: Math.random() * 0.03 + 0.006
          });
        }
      });
      meteors = new Array(8).fill(0).map(() => spawnMeteor(true));
    };
    const resize = () => {
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      canvas.width = Math.floor(W * DPR);
      canvas.height = Math.floor(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      init();
    };
    const frame = () => {
      ctx.fillStyle = "#04030c";
      ctx.fillRect(0, 0, W, H);
      for (const st of field) {
        st.y += st.sp * speed;
        if (st.y > H + 2) {
          st.y = -2;
          st.x = Math.random() * W;
        }
        st.tw += st.tws;
        const a = 0.38 + Math.abs(Math.sin(st.tw)) * 0.55;
        const tint = st.r > 1.35;
        const cr = tint ? Math.round((230 + accent[0]) / 2) : 224;
        const cg = tint ? 255 : 244;
        const cb = tint ? Math.round((228 + accent[2]) / 2) : 236;
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`;
        ctx.beginPath();
        ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < meteors.length; i++) {
        const m = meteors[i];
        if (m.delay > 0) {
          m.delay -= 1;
          continue;
        }
        m.x -= m.sp;
        m.y += m.sp;
        const tailX = m.x + m.len * 0.7,
          tailY = m.y - m.len * 0.7;
        const g = ctx.createLinearGradient(m.x, m.y, tailX, tailY);
        g.addColorStop(0, `rgba(${accent[0]},${accent[1]},${accent[2]},0.95)`);
        g.addColorStop(0.4, `rgba(${accent2[0]},${accent2[1]},${accent2[2]},0.5)`);
        g.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = g;
        ctx.lineWidth = 2.2;
        ctx.lineCap = "round";
        ctx.shadowColor = `rgba(${accent[0]},${accent[1]},${accent[2]},0.7)`;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(m.x, m.y);
        ctx.lineTo(tailX, tailY);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = "rgba(235,255,242,0.97)";
        ctx.beginPath();
        ctx.arc(m.x, m.y, 1.9, 0, Math.PI * 2);
        ctx.fill();
        if (m.x < -m.len || m.y > H + m.len) meteors[i] = spawnMeteor(false);
      }
      raf = requestAnimationFrame(frame);
    };
    window.addEventListener("resize", resize);
    resize();
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);
  return /*#__PURE__*/React.createElement("canvas", {
    ref: canvasRef,
    className: "arc-canvas"
  });
}
window.Starfield = Starfield;