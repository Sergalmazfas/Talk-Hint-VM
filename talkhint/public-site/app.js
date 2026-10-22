(() => {
  const byId = (id) => document.getElementById(id);
  const home = byId("home-view");
  const routeView = byId("route-view");
  const path = window.location.pathname.replace(/\/+$/, "") || "/";

  const examples = {
    incoming: {
      label: "Demo conversation · Incoming",
      title: "Incoming call",
      lines: [
        ["Caller", "What are your Saturday hours?"],
        ["Secretary", "We’re open Saturday from 9 am to 2 pm."]
      ],
      summary: "Asked about Saturday hours. Told 9 am–2 pm."
    },
    outgoing: {
      label: "Demo conversation · Outgoing",
      title: "Outgoing task",
      lines: [
        ["Owner task", "Ask the service about its Saturday hours."],
        ["Secretary", "Hello, what are your Saturday opening hours?"],
        ["Service", "We’re open Saturday from 9 am to 2 pm."]
      ],
      summary: "Asked the service and confirmed Saturday hours: 9 am–2 pm."
    }
  };

  function setDialogue(container, lines) {
    if (!container) return;
    container.replaceChildren(...lines.map(([speaker, text]) => {
      const row = document.createElement("div");
      row.className = "line";
      const name = document.createElement("strong");
      name.textContent = speaker;
      const words = document.createElement("span");
      words.textContent = text;
      row.append(name, words);
      return row;
    }));
  }

  function updateHeroDemo(direction) {
    const demo = examples[direction];
    document.querySelectorAll("[data-demo]").forEach((tab) => {
      const selected = tab.dataset.demo === direction;
      tab.setAttribute("aria-selected", String(selected));
      tab.setAttribute("tabindex", selected ? "0" : "-1");
    });
    const panel = byId("hero-demo-content");
    panel.setAttribute("aria-labelledby", direction === "incoming" ? "hero-incoming-tab" : "hero-outgoing-tab");
    const label = document.querySelector("[data-demo-kind]");
    label.textContent = demo.label;
    setDialogue(document.querySelector("[data-demo-dialogue]"), demo.lines);
    document.querySelector("[data-demo-summary]").textContent = demo.summary;
  }

  function updateListen(direction) {
    const demo = examples[direction];
    document.querySelectorAll("[data-listen]").forEach((tab) => {
      const selected = tab.dataset.listen === direction;
      tab.setAttribute("aria-selected", String(selected));
      tab.setAttribute("tabindex", selected ? "0" : "-1");
    });
    byId("listen-dialogue").setAttribute("aria-labelledby", direction === "incoming" ? "listen-incoming-tab" : "listen-outgoing-tab");
    byId("listen-preview-title").textContent = direction === "incoming" ? "Incoming call" : "Outgoing task";
    setDialogue(byId("listen-dialogue"), demo.lines);
    byId("listen-summary").textContent = demo.summary;
  }

  document.querySelectorAll("[data-demo]").forEach((tab) => {
    tab.addEventListener("click", () => updateHeroDemo(tab.dataset.demo));
  });
  document.querySelectorAll("[data-listen]").forEach((tab) => {
    tab.addEventListener("click", () => updateListen(tab.dataset.listen));
  });

  document.querySelectorAll('[role="tablist"]').forEach((list) => {
    list.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const tabs = [...list.querySelectorAll('[role="tab"]')];
      const current = tabs.indexOf(document.activeElement);
      if (current < 0) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 :
        (current + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length;
      tabs[next].focus();
      tabs[next].click();
    });
  });

  const menuButton = document.querySelector(".menu-toggle");
  const nav = byId("primary-nav");
  menuButton?.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    nav.classList.toggle("is-open", open);
  });
  nav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    nav.classList.remove("is-open");
    menuButton?.setAttribute("aria-expanded", "false");
    menuButton?.setAttribute("aria-label", "Open navigation");
  }));

  function renderCapabilities(payload) {
    const configured = payload?.secretary;
    if (!configured?.provider || !configured?.model || !configured?.configuredVoice || !Array.isArray(configured.voices)) {
      throw new Error("Verified voice configuration is unavailable");
    }
    const rawChoices = configured.voices;
    const choices = Array.isArray(rawChoices) ? rawChoices : [];
    const list = byId("voice-list");
    if (!list) return;
    const activeFilter = document.querySelector("[data-voice-filter][aria-pressed='true']")?.dataset.voiceFilter || "all";
    const filtered = choices.filter((voice) => {
      const gender = String(voice.gender || voice.voiceGender || "").toLowerCase();
      return activeFilter === "all" || gender === activeFilter;
    });
    if (activeFilter === "male" && filtered.length === 0) {
      list.innerHTML = '<div class="empty-voice">No verified male voice recordings or choices are available to show.</div>';
    } else if (filtered.length === 0) {
      const current = configured.configuredVoice;
      if (activeFilter === "all" && current) {
        const item = document.createElement("div");
        item.className = "voice-option";
        const name = document.createElement("span");
        const strong = document.createElement("b");
        strong.textContent = String(current);
        const note = document.createElement("small");
        note.textContent = "Configured voice · public audio preview unavailable";
        name.append(strong, note);
        const disabled = document.createElement("button");
        disabled.type = "button";
        disabled.disabled = true;
        disabled.textContent = "No recording";
        item.append(name, disabled);
        list.replaceChildren(item);
      } else {
        list.innerHTML = '<div class="empty-voice">No other verified voice choices or recordings are available to show.</div>';
      }
    } else {
      list.replaceChildren(...filtered.map((voice) => {
        const item = document.createElement("div");
        item.className = "voice-option";
        const name = document.createElement("span");
        const strong = document.createElement("b");
        strong.textContent = String(voice.label || voice.id);
        const note = document.createElement("small");
        note.textContent = "Configured voice · public audio preview unavailable";
        name.append(strong, note);
        const disabled = document.createElement("button");
        disabled.type = "button";
        disabled.disabled = true;
        disabled.textContent = "No recording";
        item.append(name, disabled);
        return item;
      }));
    }
    const provider = configured.provider;
    const model = configured.model;
    const voiceName = configured.configuredVoice;
    const reasoning = configured.reasoningModel;
    byId("capability-facts").textContent = `${provider} ${model}; built-in ${voiceName} voice; reasoning ${reasoning}. No approved public recordings were found, so playback stays unavailable. This does not mean Dev MCP is enabled.`;
  }

  let capabilitiesPayload = null;
  let capabilitiesFailed = false;
  async function loadCapabilities() {
    const list = byId("voice-list");
    if (capabilitiesPayload) {
      renderCapabilities(capabilitiesPayload);
      return;
    }
    if (capabilitiesFailed) {
      if (list && document.querySelector("[data-voice-filter][aria-pressed='true']")?.dataset.voiceFilter === "male") {
        list.innerHTML = '<div class="empty-voice">No approved male voice recordings or verified male voice choices are available to show.</div>';
      }
      return;
    }
    if (list) list.innerHTML = '<div class="empty-voice">Checking currently verified voice choices…</div>';
    try {
      const response = await fetch("/site/capabilities.json", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Capabilities not available");
      const payload = await response.json();
      renderCapabilities(payload);
      capabilitiesPayload = payload;
    } catch {
      capabilitiesFailed = true;
      if (list) {
        const isMale = document.querySelector("[data-voice-filter][aria-pressed='true']")?.dataset.voiceFilter === "male";
        list.innerHTML = isMale
          ? '<div class="empty-voice">No approved male public recordings are available. Playback is disabled.</div>'
          : '<div class="empty-voice">Verified voice details could not be loaded. No audio preview or unverified voice choices are offered here. <button type="button" data-retry-capabilities>Retry</button></div>';
      }
      const facts = byId("capability-facts");
      if (facts) facts.textContent = "The public capabilities file could not be loaded. Current implementation facts are not confirmed in this browser.";
      list?.querySelector("[data-retry-capabilities]")?.addEventListener("click", () => {
        capabilitiesFailed = false;
        loadCapabilities();
      });
    }
  }
  document.querySelectorAll("[data-voice-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-voice-filter]").forEach((other) => other.setAttribute("aria-pressed", String(other === button)));
      loadCapabilities();
    });
  });
  document.querySelector("[data-load-capabilities]")?.addEventListener("click", loadCapabilities);

  const startSteps = [
    {
      title: "Link the TalkHint account you already have",
      body: `<p>TalkHint connects from ChatGPT using its custom MCP connection. Use your existing TalkHint account’s authorization step inside ChatGPT. There is no customer signup or password form on this page.</p>
        <div class="step-links"><div class="step-link"><span><strong>Connection address</strong><small>https://talkhint.app/api/chatgpt/mcp</small></span><button class="button button-secondary" type="button" data-copy-mcp>Copy address</button></div></div>
        <p class="support-pending">This customer web sign-in handoff is not available yet. Do not use the owner-only Google sign-in.</p>
        <a class="button button-primary" href="/account">See account connection details <span aria-hidden="true">↗</span></a>`
    },
    {
      title: "Tell your secretary about the business",
      body: `<p>In ChatGPT, describe what your business does and use its supported TalkHint connection. A custom MCP connection is available only on ChatGPT plans and accounts that support custom connections.</p>
        <div class="step-links"><a class="step-link" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer"><span><strong>Open ChatGPT</strong><small>Use the TalkHint connection there when available.</small></span><span aria-hidden="true">↗</span></a></div>
        <p class="support-pending">The card-editing tools are not yet available in MCP. This step cannot create or change a business card from this website.</p>`
    },
    {
      title: "Review the verified business card",
      body: `<p>Before relying on a secretary, review what its existing card says. The card—not an intake form—defines the facts it can use.</p>
        <ul class="checklist"><li>Services</li><li>Address</li><li>Opening hours</li><li>Prices</li><li>Business rules</li><li>What to say when unsure</li></ul>
        <p class="support-pending">There is no card editor in this public flow. Do not treat these checklist items as saved or reviewed.</p>`
    },
    {
      title: "Choose a voice and greeting",
      body: `<p>Decide how the secretary should introduce itself and what greeting fits your business. English, Russian and Spanish are intended language support; switching requires controlled live tests and does not guarantee every voice.</p>
        <p class="support-pending">Voice and greeting settings are not connected to this guided page. Nothing is saved here, and no voice recording is offered.</p>
        <a class="button button-secondary" href="/#listen">See verified voice availability <span aria-hidden="true">↗</span></a>`
    },
    {
      title: "Try a personal browser test",
      body: `<p>Test a conversation yourself before considering any real call workflow.</p>
        <p class="support-pending">A safe customer microphone bridge is not available yet. This page will not request microphone access or simulate a completed test.</p>`
    },
    {
      title: "Review settings, then repeat",
      body: `<p>Once the supported setup is available, review your settings and repeat the test after a change. Keep the business card current so answers stay grounded.</p>
        <p class="support-pending">Phone activation, real calls and setting changes are not performed here. This guide is informational until the missing integrations are ready.</p>`
    }
  ];

  function renderStart(stepIndex) {
    const item = startSteps[stepIndex];
    routeView.innerHTML = `<div class="subpage"><div class="subpage-wrap">
      <p class="eyebrow">A guided start · No changes are made here</p>
      <h1>Meet your<br>secretary.</h1>
      <p class="subpage-intro">A clear route through the setup. This public guide does not create an account, edit a card, request microphone access or place a call.</p>
      <section class="start-card" aria-live="polite">
        <div class="start-step-label"><span>STEP ${String(stepIndex + 1).padStart(2, "0")} / ${String(startSteps.length).padStart(2, "0")}</span><span>·</span><span>GUIDE</span></div>
        <div class="progress-track" role="progressbar" aria-label="Guide progress" aria-valuemin="1" aria-valuemax="${startSteps.length}" aria-valuenow="${stepIndex + 1}"><span style="width:${((stepIndex + 1) / startSteps.length) * 100}%"></span></div>
        <div class="start-step-body"><h2>${item.title}</h2>${item.body}</div>
        <div class="start-actions"><button class="button button-secondary" type="button" data-start-prev ${stepIndex === 0 ? "disabled" : ""}>Back</button><button class="button button-primary" type="button" data-start-next>${stepIndex === startSteps.length - 1 ? "Back to first step" : "Next step"} <span aria-hidden="true">→</span></button></div>
      </section>
      <a class="home-link" href="/">← Back to TalkHint</a>
    </div></div>`;
    routeView.querySelector("[data-start-prev]").addEventListener("click", () => renderStart(Math.max(0, stepIndex - 1)));
    routeView.querySelector("[data-start-next]").addEventListener("click", () => renderStart(stepIndex === startSteps.length - 1 ? 0 : stepIndex + 1));
    routeView.querySelector("[data-copy-mcp]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      const status = document.createElement("span");
      status.className = "sr-only";
      status.setAttribute("role", "status");
      try {
        await navigator.clipboard.writeText("https://talkhint.app/api/chatgpt/mcp");
        button.textContent = "Copied";
        button.after(status);
        status.textContent = "MCP address copied.";
      } catch {
        button.textContent = "Copy unavailable";
        button.after(status);
        status.textContent = "Clipboard access is unavailable. See account connection details to copy the address.";
      }
    });
  }

  function routePage(title, intro, content) {
    return `<div class="subpage"><div class="subpage-wrap"><p class="eyebrow">TalkHint · Public information</p><h1>${title}</h1><p class="subpage-intro">${intro}</p>${content}<a class="home-link" href="/">← Back to TalkHint</a></div></div>`;
  }

  function renderRoute() {
    if (path === "/" || path === "/index.html") return;
    home.hidden = true;
    routeView.hidden = false;
    if (path === "/start") {
      document.title = "Get started — TalkHint";
      renderStart(0);
      return;
    }
    if (path === "/account") {
      document.title = "Connect through ChatGPT — TalkHint";
      routeView.innerHTML = routePage("Connect through ChatGPT.", "A TalkHint customer sign-in handoff on the web is not available yet. There is no customer password or self-serve signup here.", `<section class="notice-card">
        <span class="status-label">Connection handoff pending</span>
        <h2>Use the existing account flow inside ChatGPT</h2>
        <p>In ChatGPT, open its settings for Apps or Connectors, choose the option to add a custom connection, and enter the MCP address below. Menu labels can vary by plan and product version. When prompted, authorize with your existing TalkHint account through ChatGPT’s OAuth flow.</p>
        <p>Custom connections are not available on every ChatGPT account or free plan. This instruction does not imply that Dev MCP is enabled. TalkHint’s Google sign-in is owner-only and is not for customers.</p>
        <div class="copy-row"><code>https://talkhint.app/api/chatgpt/mcp</code><button class="button button-primary" type="button" data-account-copy>Copy MCP address</button></div>
        <div class="copy-feedback" role="status" aria-live="polite"></div>
        <a class="button button-secondary" href="/start">View the guided start <span aria-hidden="true">↗</span></a>
      </section>`);
      routeView.querySelector("[data-account-copy]").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        const feedback = routeView.querySelector(".copy-feedback");
        try {
          await navigator.clipboard.writeText("https://talkhint.app/api/chatgpt/mcp");
          button.textContent = "Copied";
          feedback.textContent = "MCP address copied.";
        } catch {
          feedback.textContent = "Clipboard access is unavailable. Select and copy the address above.";
        }
      });
      return;
    }
    const pending = `<div class="support-pending"><strong>Publication pending.</strong> This page is a draft. The owner must verify the details before it can be treated as an approved policy or support channel.</div>`;
    if (path === "/privacy") {
      document.title = "Privacy publication pending — TalkHint";
      routeView.innerHTML = routePage("Privacy details are pending.", "We are not publishing an unverified privacy policy as if it were approved.", `<section class="notice-card"><h2>Owner review required</h2><p>The legal entity, data-handling disclosures, retention details and contact information have not been verified for publication.</p>${pending}<p>Do not treat this draft page as a complete privacy policy.</p></section>`);
    } else if (path === "/terms") {
      document.title = "Terms publication pending — TalkHint";
      routeView.innerHTML = routePage("Terms are pending.", "A complete, owner-approved set of terms is not available for this public draft.", `<section class="notice-card"><h2>Publication pending</h2><p>The contracting entity, service terms, limitations and applicable contact details need owner verification.</p>${pending}<p>This page is not an approved legal agreement.</p></section>`);
    } else if (path === "/support") {
      document.title = "Support details pending — TalkHint";
      routeView.innerHTML = routePage("Support details are pending.", "We do not have a verified public support address to publish here.", `<section class="notice-card"><h2>Support contact not verified</h2><p>No support email or legal entity has been approved for publication. We will not invent a contact channel.</p>${pending}<p>SMS and email delivery are not promised or implied by this page.</p></section>`);
    } else {
      document.title = "Page not found — TalkHint";
      routeView.innerHTML = routePage("This page isn’t here.", "The address may have changed. Head back to the TalkHint overview.", `<section class="notice-card"><h2>Explore TalkHint</h2><p>Learn how the phone secretary works and see the current setup limits.</p><a class="button button-primary" href="/">Go to the home page</a></section>`);
    }
  }

  updateHeroDemo("incoming");
  updateListen("incoming");
  renderRoute();
})();
