(() => {
  "use strict";

  const GISCUS_ORIGIN = "https://giscus.app";
  const GISCUS_CONFIG = {
    repo: "tombirdQAQ/SJTU-AI-Course",
    repoId: "R_kgDOTJHrpg",
    category: "Announcements",
    categoryId: "DIC_kwDOTJHrps4DAMXm",
  };

  function theme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark_dimmed" : "light";
  }

  // giscus 的 client.js 会复用页面上第一个已存在的 .giscus 容器，
  // 单页面同时只能有一个实例；挂载新实例前必须清掉旧实例，
  // 否则 iframe 会被塞进其他（可能隐藏的）容器里。
  function unmountAll() {
    document.querySelectorAll(".giscus").forEach((el) => el.remove());
    document.querySelectorAll(`script[src^="${GISCUS_ORIGIN}"]`).forEach((el) => el.remove());
    document.querySelectorAll("[data-giscus-mounted]").forEach((el) => {
      delete el.dataset.giscusMounted;
    });
  }

  function mountDiscussion(host, mapping, term) {
    if (!host || host.dataset.giscusMounted === "true") return;
    unmountAll();
    host.dataset.giscusMounted = "true";

    const script = document.createElement("script");
    script.src = `${GISCUS_ORIGIN}/client.js`;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.repo = GISCUS_CONFIG.repo;
    script.dataset.repoId = GISCUS_CONFIG.repoId;
    script.dataset.category = GISCUS_CONFIG.category;
    script.dataset.categoryId = GISCUS_CONFIG.categoryId;
    script.dataset.mapping = mapping;
    script.dataset.term = term;
    script.dataset.strict = "1";
    script.dataset.reactionsEnabled = "1";
    script.dataset.emitMetadata = "0";
    script.dataset.inputPosition = "top";
    script.dataset.theme = theme();
    script.dataset.lang = "zh-CN";
    script.dataset.loading = "lazy";
    host.append(script);
  }

  function updateTheme(nextTheme) {
    document.querySelectorAll(".giscus-frame").forEach((frame) => {
      frame.contentWindow?.postMessage({
        giscus: { setConfig: { theme: nextTheme === "dark" ? "dark_dimmed" : "light" } },
      }, GISCUS_ORIGIN);
    });
  }

  function mountHomeDiscussion() {
    mountDiscussion(document.getElementById("homeDiscussionEmbed"), "number", "7");
  }

  mountHomeDiscussion();
  window.addEventListener("ai-course-open-home-discussion", mountHomeDiscussion);
  window.addEventListener("ai-course-theme-change", (event) => updateTheme(event.detail));
  window.addEventListener("ai-course-open-chapter-discussion", (event) => {
    const { hostId, term } = event.detail || {};
    mountDiscussion(document.getElementById(hostId), "specific", term);
  });
})();
