(() => {
  "use strict";

  const bank = window.QUESTION_BANK;
  if (!bank || !Array.isArray(bank.questions)) {
    document.body.innerHTML = "<p style='padding:2rem'>题库加载失败，请重新生成 questions.js。</p>";
    return;
  }

  const STORAGE_KEY = "ai-course-practice-v1";
  const THEME_KEY = "ai-course-theme";
  const defaultState = { attempts: 0, wrong: {}, completed: {}, results: {}, resumeAll: 0, mistakes: {} };
  let state = loadState();
  let session = null;
  let selectedAnswer = "";
  let submitted = false;
  let currentReveal = false;
  let revealGradeSelection = "correct";

  const $ = (id) => document.getElementById(id);
  const views = ["homeView", "practiceView", "completeView"];

  function loadState() {
    try {
      return normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}"));
    } catch {
      return { ...defaultState, wrong: {}, completed: {}, results: {}, mistakes: {} };
    }
  }

  function normalizeState(raw) {
    const next = { ...defaultState, ...raw };
    next.wrong = isPlainObject(next.wrong) ? next.wrong : {};
    next.completed = isPlainObject(next.completed) ? next.completed : {};
    next.results = isPlainObject(next.results) ? next.results : {};
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

  // ---- Theme (dark mode) -------------------------------------------------
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
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      /* ignore storage errors */
    }
    applyTheme(next);
  }

  function showView(id) {
    views.forEach((viewId) => $(viewId).classList.toggle("hidden", viewId !== id));
    // 回到首页时重新挂载首页讨论（章节讨论展开时会卸载它，giscus 单页面只支持一个实例）。
    if (id === "homeView") window.dispatchEvent(new CustomEvent("ai-course-open-home-discussion"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function refreshStats() {
    const wrongCount = Object.keys(state.wrong).length;
    const remainingAll = bank.questions.filter((question) => !state.completed[question.id]).length;
    $("answeredStat").textContent = state.attempts || 0;
    $("wrongStat").textContent = wrongCount;
    $("allModeDescription").textContent = remainingAll
      ? `按原顺序练习尚未作答的题目，剩余 ${remainingAll} 道。`
      : "全部题目均已练习完成。";
    $("allModeButton").textContent = remainingAll ? "开始顺序练习" : "全部题目已练完";
    $("allModeButton").disabled = remainingAll === 0;
    $("wrongModeDescription").textContent = wrongCount
      ? `当前有 ${wrongCount} 道错题，答对后可移出错题本。`
      : "目前还没有错题。";
    $("wrongModeButton").disabled = wrongCount === 0;
    $("completeWrongButton").disabled = wrongCount === 0;
  }

  function renderHome() {
    const total = bank.questions.length;
    $("questionCount").textContent = total;

    // Learned = questions that have been completed at least once.
    const learnedByDoc = {};
    let totalLearned = 0;
    bank.questions.forEach((question) => {
      if (state.completed[question.id]) {
        learnedByDoc[question.documentIndex] = (learnedByDoc[question.documentIndex] || 0) + 1;
        totalLearned += 1;
      }
    });

    const overallPct = total ? Math.round((totalLearned / total) * 100) : 0;
    $("learnedStat").textContent = totalLearned;
    $("learnedPct").textContent = `${overallPct}%`;
    $("overallBar").style.width = `${overallPct}%`;

    $("documentList").innerHTML = bank.documents.map((doc, index) => {
      const learned = learnedByDoc[index] || 0;
      const pct = doc.questionCount ? Math.round((learned / doc.questionCount) * 100) : 0;
      const chapterCompleted = learned >= doc.questionCount;
      return `
      <div class="document-row">
        <span class="document-order">${String(index + 1).padStart(2, "0")}</span>
        <div class="document-main">
          <span class="document-name" title="${escapeHtml(doc.name)}">${escapeHtml(doc.name.replace(/\.pdf$/i, ""))}</span>
          <div class="document-progress">
            <div class="doc-track"><div class="doc-bar" style="width:${pct}%"></div></div>
            <span class="document-learned">已学 ${learned}/${doc.questionCount}</span>
          </div>
        </div>
        <span class="document-count">${doc.questionCount} 题</span>
        <button class="chapter-practice-button" type="button" data-document-index="${index}" ${chapterCompleted ? "disabled" : ""}>${chapterCompleted ? "已完成" : "练习本章"}</button>
      </div>`;
    }).join("");
    document.querySelectorAll(".chapter-practice-button").forEach((button) => {
      button.addEventListener("click", () => startSession("chapter", Number(button.dataset.documentIndex)));
    });
    refreshStats();
  }

  function startSession(mode, documentIndex = null) {
    const validDocumentIndex = Number.isInteger(documentIndex)
      && documentIndex >= 0
      && documentIndex < bank.documents.length;
    const questions = mode === "wrong"
      ? bank.questions.filter((question) => state.wrong[question.id])
      : mode === "chapter" && validDocumentIndex
        ? bank.questions.filter((question) => question.documentIndex === documentIndex)
        : bank.questions;
    if (!questions.length) return;

    const firstIndex = mode === "all" || mode === "chapter"
      ? findNextUncompletedIndex(questions, -1)
      : 0;
    if (firstIndex === -1) return;

    session = {
      mode,
      documentIndex: mode === "chapter" ? documentIndex : null,
      questions,
      index: firstIndex,
      correct: 0,
      incorrect: 0,
      revealed: 0,
      removed: 0,
      answers: {},
    };
    showView("practiceView");
    renderQuestion();
  }

  function sessionLabel() {
    if (session?.mode === "wrong") return "错题练习";
    if (session?.mode === "chapter") {
      const document = bank.documents[session.documentIndex];
      return `${document?.name.replace(/\.pdf$/i, "") || "本章"} · 章节练习`;
    }
    return "顺序练习";
  }

  function optionsFor(question) {
    if (question.options.length) return question.options;
    if (question.type === "判断题") {
      return [{ key: "正确", text: "正确" }, { key: "错误", text: "错误" }];
    }
    return [];
  }

  function renderQuestion() {
    const question = session.questions[session.index];
    selectedAnswer = "";
    submitted = false;
    currentReveal = false;
    revealGradeSelection = "correct";

    $("modeLabel").textContent = sessionLabel();
    $("progressText").textContent = `${session.index + 1} / ${session.questions.length}`;
    $("progressBar").style.width = `${((session.index + 1) / session.questions.length) * 100}%`;
    $("typeBadge").textContent = question.type;
    $("sourceLabel").textContent = `${question.document.replace(/\.pdf$/i, "")} · 第 ${question.page} 页 · 题 ${question.number}`;
    $("pdfLink").href = encodeURI(question.pdf) + `#page=${question.page}`;
    $("questionPrompt").innerHTML = formatPrompt(question.prompt, question.type);
    renderQuestionDiscussion(question);
    $("feedbackPanel").className = "feedback hidden";
    $("wrongToggleButton").classList.remove("hidden");
    $("revealGradeControls").className = "reveal-grade hidden";
    $("revealGradeControls").innerHTML = "";
    $("gradingHint").classList.add("hidden");
    $("gradingHint").textContent = "";
    $("submitButton").classList.remove("hidden");
    $("nextButton").classList.add("hidden");
    $("skipButton").classList.remove("hidden");
    $("removeWrongButton").classList.toggle("hidden", session.mode !== "wrong");
    $("prevButton").disabled = session.index === 0;

    const options = optionsFor(question);

    if (options.length) {
      currentReveal = false;
      $("submitButton").textContent = "提交答案";
      $("submitButton").disabled = true;
      $("submitButton").classList.add("hidden");
      $("answerArea").innerHTML = options.map((option) => `
        <button class="option" type="button" data-answer="${escapeHtml(option.key)}">
          <span class="option-key">${escapeHtml(option.key)}</span>
          <span>${escapeHtml(option.text)}</span>
        </button>
      `).join("");
      document.querySelectorAll(".option").forEach((button) => {
        button.addEventListener("click", () => {
          selectOption(button.dataset.answer);
          submitAnswer();
        });
      });
    } else {
      // 填空题 / 简答题 / 计算题：显示参考答案后由用户自评正确或错误。
      currentReveal = true;
      $("submitButton").textContent = "显示答案";
      $("submitButton").disabled = false;
      $("answerArea").innerHTML = `
        <div class="reveal-note">本题为${escapeHtml(question.type)}，请先在脑海或纸上作答，再点击「显示答案」对照参考答案并自评正确 / 错误。</div>
      `;
    }

    // 返回上一题时，恢复本轮已作答的状态（不重复计分）。
    const record = session.answers[question.id]
      || (session.mode === "all" || session.mode === "chapter" ? completedRecord(question) : null);
    if (record) restoreAnswered(question, record);
  }

  function completedRecord(question) {
    if (!state.completed[question.id]) return null;
    const result = isPlainObject(state.results[question.id]) ? state.results[question.id] : {};
    return { completed: true, isCorrect: typeof result.isCorrect === "boolean" ? result.isCorrect : null };
  }

  function findNextUncompletedIndex(questions, startIndex) {
    for (let index = startIndex + 1; index < questions.length; index += 1) {
      if (!state.completed[questions[index].id]) return index;
    }
    return -1;
  }

  function selectOption(value) {
    if (submitted) return;
    selectedAnswer = value;
    document.querySelectorAll(".option").forEach((button) => {
      button.classList.toggle("selected", button.dataset.answer === value);
    });
    $("submitButton").disabled = false;
  }

  // 用上 / 下方向键在选项之间移动选择（选择题、判断题）。
  function moveSelection(delta) {
    if (submitted) return;
    const options = [...document.querySelectorAll(".option")];
    if (!options.length) return;
    const current = options.findIndex((button) => button.dataset.answer === selectedAnswer);
    const next = current === -1
      ? (delta > 0 ? 0 : options.length - 1)
      : (current + delta + options.length) % options.length;
    selectOption(options[next].dataset.answer);
    options[next].scrollIntoView({ block: "nearest" });
  }

  function normalized(value) {
    return String(value)
      .toUpperCase()
      .replace(/[（）()\[\]【】,，、;；:：。.．\s]/g, "")
      .replace(/^答案/, "");
  }

  function grade(question, answer) {
    const expected = normalized(question.answer);
    const actual = normalized(answer);
    if (question.options.length) {
      const keys = [...question.answer.matchAll(/[A-H]/gi)].map((match) => match[0].toUpperCase()).join("");
      return actual === keys;
    }
    if (question.type === "判断题") {
      const yes = new Set(["正确", "对", "√", "TRUE", "T"]);
      const no = new Set(["错误", "错", "×", "FALSE", "F"]);
      return (yes.has(actual) && yes.has(expected)) || (no.has(actual) && no.has(expected));
    }
    return actual === expected;
  }

  function finishButtons() {
    $("submitButton").classList.add("hidden");
    $("skipButton").classList.add("hidden");
    $("nextButton").classList.remove("hidden");
    $("nextButton").textContent = session.index + 1 === session.questions.length ? "查看结果" : "下一题";
  }

  function paintOptions(question, isCorrect, selected) {
    document.querySelectorAll(".option").forEach((button) => {
      button.disabled = true;
      const key = button.dataset.answer;
      if (key === selected) button.classList.add("selected");
      if (normalized(question.answer).includes(normalized(key))) button.classList.add("correct");
      if (!isCorrect && key === selected) button.classList.add("incorrect");
    });
  }

  function showGradedFeedback(question, isCorrect, selected) {
    paintOptions(question, isCorrect, selected);
    $("feedbackPanel").className = `feedback ${isCorrect ? "correct-feedback" : "wrong-feedback"}`;
    $("feedbackTitle").textContent = isCorrect ? "回答正确" : "回答错误";
    $("correctAnswer").textContent = question.answer;
    $("explanation").textContent = question.explanation || "PDF 未提供单独解析。";
    $("explanationRow").classList.toggle("hidden", !question.explanation);
    $("wrongToggleButton").classList.remove("hidden");
    $("revealGradeControls").className = "reveal-grade hidden";
    $("revealGradeControls").innerHTML = "";
    updateWrongToggle(question);
    finishButtons();
  }

  function showRevealFeedback(question) {
    $("feedbackPanel").className = "feedback";
    $("feedbackTitle").textContent = "参考答案";
    $("correctAnswer").textContent = question.answer;
    $("explanation").textContent = question.explanation || "PDF 未提供单独解析。";
    $("explanationRow").classList.toggle("hidden", !question.explanation);
    $("wrongToggleButton").classList.remove("hidden");
    updateWrongToggle(question);
    renderRevealGradeControls();
    finishButtons();
  }

  function currentRevealRecord() {
    const question = session?.questions?.[session.index];
    const record = question ? session?.answers?.[question.id] : null;
    return record?.reveal ? record : null;
  }

  function renderRevealGradeControls() {
    const record = currentRevealRecord();
    if (!record) {
      $("revealGradeControls").className = "reveal-grade hidden";
      $("revealGradeControls").innerHTML = "";
      return;
    }

    revealGradeSelection = record.selfGrade || "correct";
    record.selfGrade = revealGradeSelection;
    const finalized = Boolean(record.selfGradeFinalized);
    const disabled = finalized ? "disabled" : "";
    $("revealGradeControls").className = `reveal-grade${finalized ? " is-finalized" : ""}`;
    $("revealGradeControls").innerHTML = `
      <div class="reveal-grade-head">
        <span>自评结果</span>
        <span class="reveal-grade-hint">${finalized ? "已记录" : "默认正确，可用上下键切换，Enter 进入下一题"}</span>
      </div>
      <div class="reveal-grade-options" role="radiogroup" aria-label="自评结果">
        <button class="grade-choice correct ${revealGradeSelection === "correct" ? "selected" : ""}" type="button" data-reveal-grade="correct" aria-pressed="${revealGradeSelection === "correct"}" ${disabled}>正确</button>
        <button class="grade-choice wrong ${revealGradeSelection === "wrong" ? "selected" : ""}" type="button" data-reveal-grade="wrong" aria-pressed="${revealGradeSelection === "wrong"}" ${disabled}>错误</button>
      </div>
    `;
    document.querySelectorAll("[data-reveal-grade]").forEach((button) => {
      button.addEventListener("click", () => selectRevealGrade(button.dataset.revealGrade));
    });
  }

  function selectRevealGrade(value) {
    const record = currentRevealRecord();
    if (!record || record.selfGradeFinalized) return;
    record.selfGrade = value === "wrong" ? "wrong" : "correct";
    revealGradeSelection = record.selfGrade;
    renderRevealGradeControls();
  }

  function moveRevealGrade(delta) {
    const record = currentRevealRecord();
    if (!record || record.selfGradeFinalized) return;
    const values = ["correct", "wrong"];
    const current = values.indexOf(record.selfGrade || "correct");
    const next = (current + delta + values.length) % values.length;
    selectRevealGrade(values[next]);
  }

  function finalizeRevealGrade() {
    const record = currentRevealRecord();
    if (!record || record.selfGradeFinalized) return;

    const question = session.questions[session.index];
    const isCorrect = (record.selfGrade || "correct") !== "wrong";
    record.selfGrade = isCorrect ? "correct" : "wrong";
    record.selfGradeFinalized = true;
    record.isCorrect = isCorrect;
    state.results[question.id] = { isCorrect, answeredAt: new Date().toISOString() };

    if (isCorrect) {
      session.correct += 1;
      if (session.mode === "wrong") delete state.wrong[question.id];
    } else {
      session.incorrect += 1;
      recordMistake(question, "practice");
    }

    saveState();
    renderRevealGradeControls();
  }

  function restoreAnswered(question, record) {
    submitted = true;
    if (record.reveal) {
      showRevealFeedback(question);
      return;
    }
    if (typeof record.isCorrect !== "boolean") {
      showCompletedReadOnlyFeedback(question);
      return;
    }
    selectedAnswer = record.selected || "";
    showGradedFeedback(question, record.isCorrect, record.selected);
  }

  function showCompletedReadOnlyFeedback(question) {
    $("answerArea").innerHTML = `<div class="reveal-note">这道题已在此前完成，回看时仅供复习，不能再次作答。</div>`;
    $("feedbackPanel").className = "feedback";
    $("feedbackTitle").textContent = "已完成题目";
    $("correctAnswer").textContent = question.answer;
    $("explanation").textContent = question.explanation || "PDF 未提供单独解析。";
    $("explanationRow").classList.toggle("hidden", !question.explanation);
    $("wrongToggleButton").classList.add("hidden");
    finishButtons();
  }

  function onSubmitClick() {
    if (currentReveal) revealAnswer();
    else submitAnswer();
  }

  function submitAnswer() {
    if (submitted || !selectedAnswer.trim()) return;
    submitted = true;
    const question = session.questions[session.index];
    const isCorrect = grade(question, selectedAnswer);

    const firstTime = session.mode === "wrong"
      ? !session.answers[question.id]
      : !state.completed[question.id];
    if (firstTime) {
      state.attempts = (state.attempts || 0) + 1;
      state.completed[question.id] = (state.completed[question.id] || 0) + 1;
      state.results[question.id] = { isCorrect, answeredAt: new Date().toISOString() };
      if (isCorrect) {
        session.correct += 1;
        if (session.mode === "wrong") delete state.wrong[question.id];
      } else {
        session.incorrect += 1;
        recordMistake(question, "practice");
      }
      session.answers[question.id] = { selected: selectedAnswer, isCorrect };
      saveState();
    }

    showGradedFeedback(question, isCorrect, selectedAnswer);
  }

  function revealAnswer() {
    if (submitted) return;
    submitted = true;
    const question = session.questions[session.index];

    const firstTime = session.mode === "wrong"
      ? !session.answers[question.id]
      : !state.completed[question.id];
    if (firstTime) {
      state.attempts = (state.attempts || 0) + 1;
      state.completed[question.id] = (state.completed[question.id] || 0) + 1;
      session.revealed += 1;
      session.answers[question.id] = { reveal: true, selfGrade: "correct", selfGradeFinalized: false };
      saveState();
    }

    showRevealFeedback(question);
  }

  function updateWrongToggle(question) {
    const inWrongBook = Boolean(state.wrong[question.id]);
    $("wrongToggleButton").textContent = inWrongBook ? "手动移出错题本" : "手动加入错题本";
    $("wrongToggleButton").onclick = () => {
      if (state.wrong[question.id]) {
        delete state.wrong[question.id];
      } else {
        recordMistake(question, "practice", new Date().toISOString(), { manual: true });
      }
      saveState();
      updateWrongToggle(question);
    };
  }

  function prevQuestion() {
    if (!session || session.index === 0) return;
    if (submitted && currentReveal) finalizeRevealGrade();
    session.index -= 1;
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function nextQuestion() {
    if (submitted && currentReveal) finalizeRevealGrade();
    const nextIndex = session.mode === "all" || session.mode === "chapter"
      ? findNextUncompletedIndex(session.questions, session.index)
      : session.index + 1 < session.questions.length ? session.index + 1 : -1;
    if (nextIndex === -1) {
      saveState();
      $("completeTitle").textContent = session.mode === "wrong"
        ? "错题练习完成"
        : session.mode === "chapter"
          ? "章节练习完成"
          : "顺序练习完成";
      $("completeSummary").textContent =
        `本轮答对 ${session.correct} 题，答错 ${session.incorrect} 题`
        + (session.revealed ? `，查看答案 ${session.revealed} 题` : "")
        + (session.removed ? `，手动移除 ${session.removed} 题` : "")
        + `；错题本现有 ${Object.keys(state.wrong).length} 题。`;
      renderChapterDiscussion();
      showView("completeView");
      return;
    }
    session.index = nextIndex;
    renderQuestion();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function skipQuestion() {
    if (!session) return;
    const question = session.questions[session.index];
    if ((session.mode === "all" || session.mode === "chapter") && state.completed[question.id]) return;
    nextQuestion();
  }

  function removeCurrentWrong() {
    if (!session || session.mode !== "wrong") return;
    const question = session.questions[session.index];
    delete state.wrong[question.id];
    delete session.answers[question.id];
    session.removed += 1;
    saveState();
    nextQuestion();
  }

  function goHome() {
    if (session && submitted && currentReveal) finalizeRevealGrade();
    session = null;
    renderHome();
    showView("homeView");
  }

  function renderChapterDiscussion() {
    const host = $("chapterDiscussionHost");
    if (session?.mode !== "chapter") {
      host.innerHTML = "";
      return;
    }

    const document = bank.documents[session.documentIndex];
    const title = document.name.replace(/\.pdf$/i, "");
    const term = `章节讨论 · ${title}`;
    host.innerHTML = `
      <details class="chapter-discussion">
        <summary>
          <span>${escapeHtml(title)} 讨论</span>
          <span class="chapter-discussion-hint">展开讨论</span>
        </summary>
        <div class="chapter-discussion-body">
          <a class="text-button discussion-link" href="https://github.com/tombirdQAQ/SJTU-AI-Course/discussions" target="_blank" rel="noopener">在 GitHub 中查看 ↗</a>
          <div id="chapterDiscussionEmbed" class="discussion-embed"></div>
        </div>
      </details>`;

    const details = host.querySelector(".chapter-discussion");
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      window.dispatchEvent(new CustomEvent("ai-course-open-chapter-discussion", {
        detail: { hostId: "chapterDiscussionEmbed", term },
      }));
    }, { once: true });
  }

  function renderQuestionDiscussion(question) {
    const host = $("questionDiscussionHost");
    const title = question.document.replace(/\.pdf$/i, "");
    const term = `章节讨论 · ${title}`;
    host.innerHTML = `
      <details class="chapter-discussion">
        <summary>
          <span>${escapeHtml(title)} 讨论</span>
          <span class="chapter-discussion-hint">展开讨论</span>
        </summary>
        <div class="chapter-discussion-body">
          <a class="text-button discussion-link" href="https://github.com/tombirdQAQ/SJTU-AI-Course/discussions" target="_blank" rel="noopener">在 GitHub 中查看 ↗</a>
          <div id="questionDiscussionEmbed" class="discussion-embed"></div>
        </div>
      </details>`;

    const details = host.querySelector(".chapter-discussion");
    details.addEventListener("toggle", () => {
      if (!details.open) return;
      window.dispatchEvent(new CustomEvent("ai-course-open-chapter-discussion", {
        detail: { hostId: "questionDiscussionEmbed", term },
      }));
    }, { once: true });
  }

  function resetAll() {
    if (!window.confirm("确定清空答题次数、顺序进度和全部错题吗？此操作不可撤销。")) return;
    state = { ...defaultState, wrong: {}, completed: {}, results: {}, mistakes: {} };
    saveState();
    renderHome();
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function generateGitHubIssueUrl() {
    if (!session || !session.questions[session.index]) return null;
    
    const question = session.questions[session.index];
    const repoUrl = "https://github.com/tombirdQAQ/SJTU-AI-Course";
    const title = `【反馈】${question.document.replace(/\.pdf$/i, "")} - 第 ${question.page} 页 - 题 ${question.number}`;
    const body = `## 题目信息\n- **PDF**: ${question.document}\n- **页码**: 第 ${question.page} 页\n- **题号**: 第 ${question.number} 题\n- **题型**: ${question.type}\n\n## 问题描述\n请在此处描述您发现的问题：\n\n## 问题内容\n**题目**: ${question.prompt}\n\n**答案**: ${question.answer}\n\n## 建议\n请提出您的改进建议：`;
    
    const encodedTitle = encodeURIComponent(title);
    const encodedBody = encodeURIComponent(body);
    return `${repoUrl}/issues/new?title=${encodedTitle}&body=${encodedBody}`;
  }

  function reportIssue() {
    const url = generateGitHubIssueUrl();
    if (url) {
      window.open(url, "_blank", "noopener");
    }
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

  $("themeToggle").addEventListener("click", toggleTheme);
  $("allModeButton").addEventListener("click", () => startSession("all"));
  $("wrongModeButton").addEventListener("click", () => startSession("wrong"));
  $("completeWrongButton").addEventListener("click", () => startSession("wrong"));
  $("submitButton").addEventListener("click", onSubmitClick);
  $("nextButton").addEventListener("click", nextQuestion);
  $("prevButton").addEventListener("click", prevQuestion);
  $("skipButton").addEventListener("click", skipQuestion);
  $("removeWrongButton").addEventListener("click", removeCurrentWrong);
  $("reportIssueButton").addEventListener("click", reportIssue);
  $("exitButton").addEventListener("click", goHome);
  $("homeButton").addEventListener("click", goHome);
  $("completeHomeButton").addEventListener("click", goHome);
  $("resetButton").addEventListener("click", resetAll);

  let touchStart = null;
  $("practiceView").addEventListener("touchstart", (event) => {
    if (event.target.closest("button, a, textarea")) return;
    const touch = event.changedTouches[0];
    touchStart = { x: touch.clientX, y: touch.clientY };
  }, { passive: true });
  $("practiceView").addEventListener("touchend", (event) => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const deltaX = touch.clientX - touchStart.x;
    const deltaY = touch.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(deltaX) < 64 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    if (deltaX > 0) prevQuestion();
    else nextQuestion();
  }, { passive: true });

  document.addEventListener("keydown", (event) => {
    if ($("practiceView").classList.contains("hidden")) return;
    if (document.activeElement?.tagName === "TEXTAREA") return;
    if (!submitted && /^[a-h]$/i.test(event.key) && document.querySelector(".option")) {
      const target = document.querySelector(`.option[data-answer="${event.key.toUpperCase()}"]`);
      if (target) target.click();
    } else if (event.key === "ArrowDown" && !submitted && document.querySelector(".option")) {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp" && !submitted && document.querySelector(".option")) {
      event.preventDefault();
      moveSelection(-1);
    } else if (event.key === "ArrowDown" && submitted && currentReveal) {
      event.preventDefault();
      moveRevealGrade(1);
    } else if (event.key === "ArrowUp" && submitted && currentReveal) {
      event.preventDefault();
      moveRevealGrade(-1);
    } else if (event.key === "ArrowLeft") {
      prevQuestion();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      const question = session.questions[session.index];
      if ((session.mode === "all" || session.mode === "chapter") && state.completed[question.id]) nextQuestion();
      else skipQuestion();
    } else if (event.key === "Enter" && !event.shiftKey) {
      if (submitted) nextQuestion();
      else onSubmitClick();
    }
  });

  applyTheme(currentTheme());
  renderHome();
})();
