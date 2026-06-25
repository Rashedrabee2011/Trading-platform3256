(function () {
  function show(msg, isError) {
    const el = document.getElementById("regMessage");
    if (!el) return alert(msg);
    el.style.display = "block";
    el.textContent = msg;
    el.style.color = isError ? "var(--red)" : "var(--green)";
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Align inputs for RTL/LTR depending on language
    function initLanguageAlignment() {
      // Force inputs to RTL for Arabic-first UX
      const inputs = document.querySelectorAll(".auth-input");
      inputs.forEach((inp) => {
        inp.dir = "rtl";
        inp.style.textAlign = "right";
      });
    }
    initLanguageAlignment();
    const btn = document.getElementById("regBtn");
    const toggle = document.getElementById("regPwdToggle");
    const pwd = document.getElementById("reg_password");
    const pwd2 = document.getElementById("reg_password2");

    if (toggle) {
      toggle.addEventListener("click", (e) => {
        e.preventDefault();
        if (pwd.type === "password") {
          pwd.type = "text";
          toggle.textContent = "إخفاء";
        } else {
          pwd.type = "password";
          toggle.textContent = "إظهار";
        }
      });
    }

    btn.addEventListener("click", async function () {
      const fullName = document.getElementById("reg_fullName").value.trim();
      const email = document.getElementById("reg_email").value.trim();
      const phone = document.getElementById("reg_phone").value.trim();
      const p1 = pwd.value;
      const p2 = pwd2.value;
      if (!fullName || !email || !phone || !p1) {
        show("الرجاء إكمال جميع الحقول", true);
        return;
      }
      if (p1.length < 6) {
        show("كلمة المرور قصيرة، يجب أن تكون 6 أحرف على الأقل", true);
        return;
      }
      if (p1 !== p2) {
        show("كلمتا المرور غير متطابقتين", true);
        return;
      }

      btn.disabled = true;
      btn.textContent = "جاري...";
      try {
        const resp = await fetch("/api/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName, email, phone, password: p1 }),
        });
        if (resp.ok) {
          show("تم إنشاء الحساب. إعادة التوجيه...", false);
          try {
            localStorage.setItem(
              "trading_user",
              JSON.stringify({ fullName, email, phone, created: Date.now() }),
            );
          } catch (e) {}
          setTimeout(() => (location = "/"), 900);
          return;
        }
        const text = await resp.text();
        show("فشل: " + (text || resp.statusText), true);
      } catch (e) {
        // fallback save locally
        try {
          localStorage.setItem(
            "account_profile",
            JSON.stringify({ fullName, email, phone }),
          );
          try {
            localStorage.setItem(
              "trading_user",
              JSON.stringify({ fullName, email, phone, created: Date.now() }),
            );
          } catch (e) {}
          show("تم حفظ الحساب محلياً (ديمو)", false);
          setTimeout(() => (location = "/"), 900);
        } catch (err) {
          show("فشل في الحفظ المحلي", true);
        }
      } finally {
        btn.disabled = false;
        btn.textContent = "إنشاء الحساب";
      }
    });
  });
})();
