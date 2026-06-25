// login.js - small client-side login handler with RTL/LTR alignment support
(function () {
  function show(msg, isError) {
    const el = document.getElementById("loginError");
    if (!el) return alert(msg);
    el.style.display = "block";
    el.textContent = msg;
    el.style.color = isError ? "var(--red)" : "var(--green)";
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Align inputs according to language (use global isEnglish if present or document lang)
    function initLanguageAlignment() {
      const lang =
        typeof isEnglish !== "undefined"
          ? isEnglish
            ? "en"
            : "ar"
          : document.documentElement.lang || "ar";
      // Force inputs to RTL for Arabic-first UX
      const inputs = document.querySelectorAll(".auth-input");
      inputs.forEach((inp) => {
        inp.dir = "rtl";
        inp.style.textAlign = "right";
      });
    }

    initLanguageAlignment();

    // password toggle
    const pwd = document.getElementById("user_password");
    const toggle = document.getElementById("pwdToggle");
    if (toggle && pwd) {
      toggle.addEventListener("click", function (e) {
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

    const btn = document.getElementById("loginBtn");
    if (!btn) return;

    btn.addEventListener("click", async function () {
      const id = (document.getElementById("user_identifier") || {}).value || "";
      const pw = (document.getElementById("user_password") || {}).value || "";
      if (!id.trim() || !pw) {
        show("الرجاء إدخال بيانات صحيحة", true);
        return;
      }

      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = "جاري...";

      try {
        const resp = await fetch("/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identifier: id.trim(), password: pw }),
        });

        if (resp && resp.ok) {
          show("تم تسجيل الدخول، جاري التحويل...");
          try {
            localStorage.setItem(
              "trading_user",
              JSON.stringify({ identifier: id.trim(), created: Date.now() }),
            );
          } catch (e) {}
          setTimeout(() => (location = "/"), 700);
          return;
        }

        let text = "";
        try {
          text = await resp.text();
        } catch (e) {}
        show(
          "فشل الدخول: " + (text || (resp && resp.statusText) || "خطأ"),
          true,
        );
      } catch (err) {
        // fallback local session for demo
        try {
          const user = { identifier: id.trim(), created: Date.now() };
          localStorage.setItem("user_session", JSON.stringify(user));
          localStorage.setItem("trading_user", JSON.stringify(user));
        } catch (e) {}
        show("تم تسجيل الدخول محلياً (بدون خادم)", false);
        setTimeout(() => (location = "/"), 700);
      } finally {
        btn.disabled = false;
        btn.textContent = originalText || "دخول";
      }
    });
  });
})();
