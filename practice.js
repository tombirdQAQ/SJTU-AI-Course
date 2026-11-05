(() => {
  "use strict";

  const bank = window.QUESTION_BANK;
  if (!bank || !Array.isArray(bank.questions)) {
    document.body.innerHTML = "<p style='padding:2rem'>题库加载失败，请重新生成 questions.js。</p>";
    return;
  }

  const STORAGE_KEY = "ai-course-practice-v1";
  const THEME_KEY = "ai-course-theme";
  const defaultState = { attempts: 0, wrong: {}, completed: {}, resumeAll: 0, mistakes: {} };

  // Display order for question types in the assembled paper.
  const TYPE_ORDER = ["选择题", "判断题", "填空题", "计算题", "简答题"];
  const PAPER_WEIGHTS = {
    untouched: 1,
    completed: 0.85,
    historicalMistake: 1.8,
    currentWrong: 4,
    mistakeStep: 0.75,
    maxMistakeBonus: 4.5,
  };

  let state = loadState();
  let exam = null;       // { questions, answers, index }
  let reviewFilter = "all";

  const $ = (id) => document.getElementById(id);

  function loadState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
    } catch {
      return { ...defaultState, wrong: {}, completed: {}, mistakes: {} };
    }
  }

  function normalizeState(raw) {
    const next = { ...defaultState, ...raw };
    next.wrong = isPlainObject(next.wrong) ? next.wrong : {};
    next.completed = isPlainObject(next.completed) ? next.completed : {};
    next.mistakes = isPlainObject(next.mistakes) ? next.mistakes : {};

    Object.entries(next.wrong).forEach(([id, record]) => {
      const wrongRecord = isPlainObject(record) ? record : { count: Number(record) || 1 };
      next.wrong[id] = wrongRecord;
      if (next.mistakes[id]) return;
      const count = Math.max(0, Number(wrongRecord.count) || 0);
      const splitPractice = Math.max(0, Number(wrongRecord.practiceCount) || 0);
      const splitExam = Math.max(0, Number(wrongRecord.examCount) || 0);
      const splitTotal = splitPractice + splitExam;
      if (!count && !splitTotal) return;
      const fromExam = Boolean(wrongRecord.fromExam);
      next.mistakes[id] = {
        total: Math.max(count, splitTotal),
        practice: splitTotal ? splitPractice : (fromExam ? 0 : count),
        exam: splitTotal ? splitExam : (fromExam ? count : 0),
        firstAt: wrongRecord.firstAt,
        lastAt: wrongRecord.lastAt,
      };
    });

    return next;
  }

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    refreshStats();
  }

  function refreshStats() {
    $("answeredStat").textContent = state.attempts || 0;
    $("wrongStat").textContent = Object.keys(state.wrong).length;
  }

  // ---- Theme -------------------------------------------------------------
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }
  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    const button = $("themeToggle");
    button.textContent = theme === "dark" ? "☀" : "🌙";
    button.setAttribute("aria-label", theme === "dark" ? "切换浅色模式" : "切换深色模式");
    window.dispatchEvent(new CustomEvent("ai-course-theme-change", { detail: theme }));
  }
  function toggleTheme() {
    const next = currentTheme() === "dark" ? "light" : "dark";
    try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
    applyTheme(next);
  }

  function showView(id) {
    ["configView", "examView", "resultView"].forEach((viewId) => {
      $(viewId).classList.toggle("hidden", viewId !== id);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function formatPrompt(value, type) {
    let text = String(value);
    const fillLike = ["填空题", "计算题", "简答题"].includes(type);
    if (fillLike && !/(?:_{2,}|＿{2,})/.test(text)) {
      text = text
        .replace(/(=\s*)([。？?，,；;])/g, "$1______$2")
        .replace(/(为\s*)([。？?，,；;])/g, "$1______$2")
        .replace(/(越)\s*([，,。；;])/g, "$1 ______$2")
        .replace(/(小于|大于|等于|称为|约为|满足|位于|变为|反映|选择动作)\s*([。？?，,；;])/g, "$1 ______$2")
        .replace(/(填[”"']?[）)]?)\s*([，,。；;])/g, "$1 ______$2")
        .replace(/(的)\s{1,}(可以|现象|区域|正则化|网络|参数量|参\s*数量|方向|状态|影响|倍|特征值)/g, "$1 ______ $2")
        .replace(/(更)\s{1,}([（(])/g, "$1 ______ $2");
      if (!/(?:_{2,}|＿{2,})/.test(text)) {
        text = /[。？?]\s*$/.test(text)
          ? text.replace(/([。？?])\s*$/, " ______$1")
          : `${text} ______`;
      }
    }
    return escapeHtml(text).replace(/(?:_|＿){2,}/g, (match) => {
      const width = Math.max(5, Math.min(16, match.length));
      return `<span class="blank-line" style="--blank-ch:${width}ch" aria-label="填空横线"></span>`;
    });
  }

  function shuffle(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  function mistakeTotal(question) {
    const stats = isPlainObject(state.mistakes[question.id]) ? state.mistakes[question.id] : {};
    const wrongRecord = isPlainObject(state.wrong[question.id]) ? state.wrong[question.id] : {};
    return Math.max(Number(stats.total) || 0, Number(wrongRecord.count) || 0);
  }

  function paperWeight(question) {
    const totalMistakes = mistakeTotal(question);
    const mistakeBonus = Math.min(totalMistakes * PAPER_WEIGHTS.mistakeStep, PAPER_WEIGHTS.maxMistakeBonus);
    if (state.wrong[question.id]) return PAPER_WEIGHTS.currentWrong + mistakeBonus;
    if (totalMistakes > 0) return PAPER_WEIGHTS.historicalMistake + mistakeBonus;
    if (state.completed[question.id]) return PAPER_WEIGHTS.completed;
    return PAPER_WEIGHTS.untouched;
  }

  function weightedSample(pool, count) {
    const candidates = pool.slice();
    const selected = [];
    const target = Math.min(count, candidates.length);
    while (selected.length < target) {
      const totalWeight = candidates.reduce((sum, question) => sum + paperWeight(question), 0);
      let marker = Math.random() * totalWeight;
      let picked = 0;
      for (let i = 0; i < candidates.length; i += 1) {
        marker -= paperWeight(candidates[i]);
        if (marker <= 0) {
          picked = i;
          break;
        }
      }
      selected.push(candidates.splice(picked, 1)[0]);
    }
    return selected;
  }

  function optionsFor(question) {
    if (question.options.length) return question.options;
    if (question.type === "判断题") {
      return [{ key: "正确", text: "正确" }, { key: "错误", text: "错误" }];
    }
    return [];
  }

  // ---- Config (组卷) ------------------------------------------------------
  const availableTypes = TYPE_ORDER.filter((type) => bank.questions.some((q) => q.type === type));

  function selectedDocs() {
    return [...document.querySelectorAll("#scopeList input[type=checkbox]:checked")]
      .map((input) => Number(input.value));
  }

  function poolFor(docSet, type) {
    return bank.questions.filter((q) => docSet.has(q.documentIndex) && q.type === type);
  }

  function renderConfig() {
    $("scopeList").innerHTML = bank.documents.map((doc, index) => `
      <label class="scope-item">
        <input type="checkbox" value="${index}" checked>
        <span class="scope-name" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name.replace(/\.pdf$/i, ""))}</span>
        <span class="scope-count">${doc.questionCount} 题</span>
      </label>
    `).join("");

    $("typeList").innerHTML = availableTypes.map((type) => `
      <div class="type-item" data-type="${escapeHtml(type)}">
        <span class="type-name">${escapeHtml(type)}</span>
        <span class="type-available">可选 <strong data-available>0</strong></span>
        <div class="type-stepper">
          <button class="step-btn" type="button" data-step="-1">−</button>
          <input class="type-input" type="number" min="0" value="0" inputmode="numeric">
          <button class="step-btn" type="button" data-step="1">+</button>
        </div>
      </div>
    `).join("");

    document.querySelectorAll("#scopeList input").forEach((input) => {
      input.addEventListener("change", refreshAvailability);
    });
    document.querySelectorAll(".type-item").forEach((item) => {
      const input = item.querySelector(".type-input");
      input.addEventListener("input", () => { clampInput(item); updateTotal(); });
      item.querySelectorAll(".step-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          input.value = String((Number(input.value) || 0) + Number(btn.dataset.step));
          clampInput(item);
          updateTotal();
        });
      });
    });

    refreshAvailability();
  }

  function refreshAvailability() {
    const docSet = new Set(selectedDocs());
    document.querySelectorAll(".type-item").forEach((item) => {
      const type = item.dataset.type;
      const available = poolFor(docSet, type).length;
      item.querySelector("[data-available]").textContent = available;
      item.querySelector(".type-input").max = String(available);
      clampInput(item);
    });
    updateTotal();
  }

  function clampInput(item) {
    const input = item.querySelector(".type-input");
    const available = Number(input.max) || 0;
    let value = Math.floor(Number(input.value) || 0);
    if (value < 0) value = 0;
    if (value > available) value = available;
    input.value = String(value);
  }

  function updateTotal() {
    let total = 0;
    document.querySelectorAll(".type-input").forEach((input) => { total += Number(input.value) || 0; });
    $("totalCount").textContent = total;
    return total;
  }

  function fillRandom() {
    // Spread roughly 20 questions across the available types, capped by availability.
    const docSet = new Set(selectedDocs());
    const target = 20;
    const per = Math.max(1, Math.round(target / availableTypes.length));
    document.querySelectorAll(".type-item").forEach((item) => {
      const available = poolFor(docSet, item.dataset.type).length;
      item.querySelector(".type-input").value = String(Math.min(per, available));
    });
    updateTotal();
  }

  function setAllScope(checked) {
    document.querySelectorAll("#scopeList input").forEach((input) => { input.checked = checked; });
    refreshAvailability();
  }

  function startExam() {
    const docSet = new Set(selectedDocs());
    $("configError").classList.add("hidden");

    if (!docSet.size) {
      return showConfigError("请至少选择一个考试范围（PDF）。");
    }

    const picks = [];
    let requested = 0;
    document.querySelectorAll(".type-item").forEach((item) => {
      const count = Number(item.querySelector(".type-input").value) || 0;
      requested += count;
      if (count > 0) {
        const pool = poolFor(docSet, item.dataset.type);
        picks.push(...weightedSample(pool, count));
      }
    });

    if (!requested) {
      return showConfigError("请为至少一种题型设置数量。");
    }
    if (picks.length < 1) {
      return showConfigError("所选范围内没有可用题目，请调整范围或数量。");
    }

    let questions = picks;
    if ($("shuffleOrder").checked) {
      questions = shuffle(questions);
    } else {
      questions = questions.slice().sort((a, b) => {
        const ta = TYPE_ORDER.indexOf(a.type), tb = TYPE_ORDER.indexOf(b.type);
        if (ta !== tb) return ta - tb;
        if (a.documentIndex !== b.documentIndex) return a.documentIndex - b.documentIndex;
        return a.number - b.number;
      });
    }

    exam = { questions, answers: {}, index: 0, results: null };
    showView("examView");
    renderExamQuestion();
  }

  function showConfigError(message) {
    const node = $("configError");
    node.textContent = message;
    node.classList.remove("hidden");
  }

  // ---- Exam taking -------------------------------------------------------
  function hasAnswer(value) {
    return value != null && String(value).trim() !== "";
  }

  function renderExamQuestion() {
    const question = exam.questions[exam.index];
    const total = exam.questions.length;

    $("examProgressText").textContent = `${exam.index + 1} / ${total}`;
    $("examProgressBar").style.width = `${((exam.index + 1) / total) * 100}%`;
    $("examTypeBadge").textContent = question.type;
    $("examSourceLabel").textContent = `${question.document.replace(/\.pdf$/i, "")} · 第 ${question.page} 页 · 题 ${question.number}`;
    $("examPdfLink").href = encodeURI(question.pdf) + `#page=${question.page}`;
    $("examPrompt").innerHTML = formatPrompt(question.prompt, question.type);
    $("examPrev").disabled = exam.index === 0;
    $("examNext").textContent = exam.index + 1 === total ? "已是最后一题" : "下一题";
    $("examNext").disabled = exam.index + 1 === total;

    const options = optionsFor(question);
    const stored = exam.answers[exam.index];

    if (options.length) {
      $("examHint").classList.add("hidden");
      $("examAnswerArea").innerHTML = options.map((option) => `
        <button class="option" type="button" data-answer="${escapeHtml(option.key)}">
          <span class="option-key">${escapeHtml(option.key)}</span>
          <span>${escapeHtml(option.text)}</span>
        </button>
      `).join("");
      document.querySelectorAll("#examAnswerArea .option").forEach((button) => {
        button.classList.toggle("selected", button.dataset.answer === stored);
        button.addEventListener("click", () => selectExamOption(button.dataset.answer));
      });
    } else {
      $("examHint").textContent = "填空 / 计算题：填写你的答案，交卷后按忽略空格标点的规则判分；如判分有误，可在解析页手动改判。";
      $("examHint").classList.remove("hidden");
      $("examAnswerArea").innerHTML = `
        <textarea id="examText" class="text-answer exam-text" placeholder="在此作答……"></textarea>
      `;
      const textarea = $("examText");
      textarea.value = stored || "";
      textarea.addEventListener("input", (event) => {
        exam.answers[exam.index] = event.target.value;
        paintPalette();
        updateAnsweredCount();
      });
    }

    renderPalette();
    updateAnsweredCount();
  }

  function selectExamOption(value) {
    // Toggle off if clicking the already-selected option.
    exam.answers[exam.index] = exam.answers[exam.index] === value ? "" : value;
    document.querySelectorAll("#examAnswerArea .option").forEach((button) => {
      button.classList.toggle("selected", button.dataset.answer === exam.answers[exam.index]);
    });
    paintPalette();
    updateAnsweredCount();
  }

  function clearCurrent() {
    delete exam.answers[exam.index];
    renderExamQuestion();
  }

  function renderPalette() {
    $("palette").innerHTML = exam.questions.map((_, i) => `
      <button class="palette-cell" type="button" data-index="${i}">${i + 1}</button>
    `).join("");
    document.querySelectorAll(".palette-cell").forEach((cell) => {
      cell.addEventListener("click", () => { exam.index = Number(cell.dataset.index); renderExamQuestion(); });
    });
    paintPalette();
  }

  function paintPalette() {
    document.querySelectorAll(".palette-cell").forEach((cell) => {
      const i = Number(cell.dataset.index);
      cell.classList.toggle("answered", hasAnswer(exam.answers[i]));
      cell.classList.toggle("current", i === exam.index);
    });
  }

  function updateAnsweredCount() {
    const answered = exam.questions.reduce((sum, _, i) => sum + (hasAnswer(exam.answers[i]) ? 1 : 0), 0);
    $("answeredCount").textContent = `${answered}/${exam.questions.length}`;
  }

  function examPrev() {
    if (exam.index === 0) return;
    exam.index -= 1;
    renderExamQuestion();
  }
  function examNext() {
    if (exam.index + 1 >= exam.questions.length) return;
    exam.index += 1;
    renderExamQuestion();
  }

  // ---- Grading -----------------------------------------------------------
  function normalized(value) {
    return String(value)
      .toUpperCase()
      .replace(/[（）()\[\]【】,，、;；:：。.．\s]/g, "")
      .replace(/^答案/, "");
  }

  function gradeQuestion(question, answer) {
    if (!hasAnswer(answer)) return false;
    const actual = normalized(answer);
    if (question.options.length) {
      const keys = [...question.answer.matchAll(/[A-H]/gi)].map((m) => m[0].toUpperCase()).join("");
      return actual === keys;
    }
    if (question.type === "判断题") {
      const yes = new Set(["正确", "对", "√", "TRUE", "T"]);
      const no = new Set(["错误", "错", "×", "FALSE", "F"]);
      const expected = normalized(question.answer);
      return (yes.has(actual) && yes.has(expected)) || (no.has(actual) && no.has(expected));
    }
    return actual === normalized(question.answer);
  }

  function addWrong(question, now) {
    recordMistake(question, "exam", now, { fromExam: true });
  }

  function recordMistake(question, source, now = new Date().toISOString(), extra = {}) {
    const key = source === "exam" ? "exam" : "practice";
    const previousStats = isPlainObject(state.mistakes[question.id]) ? state.mistakes[question.id] : {};
    const nextStats = {
      ...previousStats,
      total: (Number(previousStats.total) || 0) + 1,
      practice: Number(previousStats.practice) || 0,
      exam: Number(previousStats.exam) || 0,
      firstAt: previousStats.firstAt || now,
      lastAt: now,
    };
    nextStats[key] += 1;
    state.mistakes[question.id] = nextStats;

    const previousWrong = isPlainObject(state.wrong[question.id]) ? state.wrong[question.id] : {};
    // Keyed by question id, so the current wrong book stays de-duplicated.
    state.wrong[question.id] = {
      ...previousWrong,
      ...extra,
      count: nextStats.total,
      practiceCount: nextStats.practice,
      examCount: nextStats.exam,
      firstAt: previousWrong.firstAt || nextStats.firstAt || now,
      lastAt: now,
    };
  }

  function revokeMistake(question, source) {
    const key = source === "exam" ? "exam" : "practice";
    const previousStats = isPlainObject(state.mistakes[question.id]) ? state.mistakes[question.id] : null;
    if (!previousStats) return;

    const nextStats = {
      ...previousStats,
      total: Math.max(0, (Number(previousStats.total) || 0) - 1),
      practice: Number(previousStats.practice) || 0,
      exam: Number(previousStats.exam) || 0,
    };
    nextStats[key] = Math.max(0, nextStats[key] - 1);

    if (nextStats.total === 0) {
      delete state.mistakes[question.id];
      return;
    }

    state.mistakes[question.id] = nextStats;
    if (state.wrong[question.id]) {
      state.wrong[question.id] = {
        ...state.wrong[question.id],
        count: nextStats.total,
        practiceCount: nextStats.practice,
        examCount: nextStats.exam,
      };
    }
  }

  function submitExam() {
    const total = exam.questions.length;
    const answered = exam.questions.reduce((sum, _, i) => sum + (hasAnswer(exam.answers[i]) ? 1 : 0), 0);
    if (!window.confirm(`确认交卷？已作答 ${answered}/${total} 题，未作答的将按错误计分。`)) return;

    const now = new Date().toISOString();
    exam.results = exam.questions.map((question, i) => ({
      question,
      answer: exam.answers[i] != null ? exam.answers[i] : "",
      correct: gradeQuestion(question, exam.answers[i]),
      overridden: false,
      mistakeRecorded: false,
    }));

    // Each exam question counts as practiced/learned exactly once; wrong ones
    // enter the shared 错题集 (de-duplicated by id).
    exam.results.forEach((result) => {
      state.attempts = (state.attempts || 0) + 1;
      state.completed[result.question.id] = (state.completed[result.question.id] || 0) + 1;
      if (!result.correct) {
        addWrong(result.question, now);
        result.mistakeRecorded = true;
      }
    });
    saveState();

    renderResult();
    showView("resultView");
  }

  // ---- Result & review ---------------------------------------------------
  function renderResult() {
    const total = exam.results.length;
    const correct = exam.results.filter((r) => r.correct).length;
    const score = total ? Math.round((correct / total) * 100) : 0;
    $("scoreValue").textContent = score;
    $("resultSummaryText").textContent = `共 ${total} 题，答对 ${correct} 题，答错 ${total - correct} 题。错题已加入错题集（去重）。`;

    // Per-type breakdown.
    const byType = {};
    exam.results.forEach((r) => {
      const t = r.question.type;
      byType[t] = byType[t] || { total: 0, correct: 0 };
      byType[t].total += 1;
      if (r.correct) byType[t].correct += 1;
    });
    $("resultBreakdown").innerHTML = Object.keys(byType).map((type) => `
      <div class="breakdown-item">
        <span class="breakdown-type">${escapeHtml(type)}</span>
        <span class="breakdown-score">${byType[type].correct}/${byType[type].total}</span>
      </div>
    `).join("");

    renderReview();
  }

  function renderReview() {
    const rows = exam.results
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => reviewFilter === "all" || !result.correct);

    $("reviewList").innerHTML = rows.map(({ result, index }) => {
      const q = result.question;
      const inWrong = Boolean(state.wrong[q.id]);
      const yourAnswer = hasAnswer(result.answer) ? escapeHtml(result.answer) : "<em>未作答</em>";
      const canOverride = !q.options.length && q.type !== "判断题"; // fill-in style
      return `
      <article class="review-item ${result.correct ? "is-correct" : "is-wrong"}" data-index="${index}">
        <div class="review-top">
          <span class="review-badge">${result.correct ? "✓ 正确" : "✗ 错误"}</span>
          <span class="review-source">${escapeHtml(q.document.replace(/\.pdf$/i, ""))} · 第 ${q.page} 页 · ${escapeHtml(q.type)}</span>
        </div>
        <p class="review-prompt">${index + 1}. ${formatPrompt(q.prompt, q.type)}</p>
        <p class="review-line"><span class="review-label">你的答案：</span><span class="review-your">${yourAnswer}</span></p>
        <p class="review-line"><span class="review-label">正确答案：</span><span class="review-correct">${escapeHtml(q.answer)}</span></p>
        ${q.explanation ? `<p class="review-line"><span class="review-label">解析：</span>${escapeHtml(q.explanation)}</p>` : ""}
        <div class="review-actions">
          ${canOverride ? `<button class="text-button" type="button" data-act="override">${result.correct ? "算我答错" : "我答对了"}</button>` : ""}
          <button class="text-button ${inWrong ? "danger" : ""}" type="button" data-act="wrong">${inWrong ? "移出错题本" : "加入错题本"}</button>
        </div>
      </article>`;
    }).join("") || `<p class="review-empty">没有符合条件的题目。</p>`;

    document.querySelectorAll(".review-item").forEach((item) => {
      const index = Number(item.dataset.index);
      const overrideBtn = item.querySelector('[data-act="override"]');
      if (overrideBtn) overrideBtn.addEventListener("click", () => overrideResult(index));
      item.querySelector('[data-act="wrong"]').addEventListener("click", () => toggleWrong(index));
    });
  }

  function overrideResult(index) {
    const result = exam.results[index];
    result.correct = !result.correct;
    result.overridden = true;
    const now = new Date().toISOString();
    if (result.correct) {
      if (result.mistakeRecorded) {
        revokeMistake(result.question, "exam");
        result.mistakeRecorded = false;
      }
      delete state.wrong[result.question.id];
    } else {
      if (!result.mistakeRecorded) {
        addWrong(result.question, now);
        result.mistakeRecorded = true;
      }
    }
    saveState();
    renderResult();
  }

  function toggleWrong(index) {
    const q = exam.results[index].question;
    if (state.wrong[q.id]) {
      delete state.wrong[q.id];
    } else {
      addWrong(q, new Date().toISOString());
    }
    saveState();
    renderReview();
  }

  function setReviewFilter(filter) {
    reviewFilter = filter;
    $("filterAll").classList.toggle("active", filter === "all");
    $("filterWrong").classList.toggle("active", filter === "wrong");
    renderReview();
  }

  function quitExam() {
    if (exam && !exam.results && !window.confirm("退出后本次组卷将丢失，确定退出？")) return;
    exam = null;
    showView("configView");
    refreshAvailability();
  }

  function retryExam() {
    exam = null;
    showView("configView");
    refreshAvailability();
  }

  // ---- Wiring ------------------------------------------------------------
  $("themeToggle").addEventListener("click", toggleTheme);
  $("scopeAll").addEventListener("click", () => setAllScope(true));
  $("scopeNone").addEventListener("click", () => setAllScope(false));
  $("fillRandom").addEventListener("click", fillRandom);
  $("startExam").addEventListener("click", startExam);
  $("quitExam").addEventListener("click", quitExam);
  $("examPrev").addEventListener("click", examPrev);
  $("examNext").addEventListener("click", examNext);
  $("examClear").addEventListener("click", clearCurrent);
  $("submitExam").addEventListener("click", submitExam);
  $("retryExam").addEventListener("click", retryExam);
  $("filterAll").addEventListener("click", () => setReviewFilter("all"));
  $("filterWrong").addEventListener("click", () => setReviewFilter("wrong"));

  document.addEventListener("keydown", (event) => {
    if (!exam || exam.results) return;
    if ($("examView").classList.contains("hidden")) return;
    if (document.activeElement?.tagName === "TEXTAREA") return;
    if (/^[a-h]$/i.test(event.key)) {
      const target = document.querySelector(`#examAnswerArea .option[data-answer="${event.key.toUpperCase()}"]`);
      if (target) target.click();
    } else if (event.key === "ArrowLeft") {
      examPrev();
    } else if (event.key === "ArrowRight") {
      examNext();
    }
  });

  applyTheme(currentTheme());
  refreshStats();
  renderConfig();
})();
