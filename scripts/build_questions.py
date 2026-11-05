"""Build the browser question bank from the course PDFs.

The output is plain JavaScript rather than JSON so index.html can be opened
directly from disk without running a local web server.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "questions.js"

SECTION_RE = re.compile(r"^[一二三四五六七八九十]+[、.．]\s*(.+)$")
# A period cannot be followed by another digit. This prevents decimal answer
# lines such as "0.0025" from being mistaken for question 0 while still
# accepting compact source text such as "3.问题".
QUESTION_RE = re.compile(r"^\s*(\d{1,3})(?:[.．](?!\d)|、)\s*(.*)$")
OPTION_RE = re.compile(r"^\s*[•·●▪]?\s*([A-H])[.．、]\s*(.*)$")
ANSWER_RE = re.compile(r"^\s*[•·●▪]?\s*(?:参考)?答案\s*[：:]\s*(.*)$")
EXPLANATION_RE = re.compile(r"^\s*[•·●▪]?\s*(?:解析|解答)\s*[：:]\s*(.*)$")


def compact(text: str) -> str:
    text = (
        text.replace("\u00a0", " ")
        .replace("\ufeff", "")
        # PDF extraction sometimes emits object/replacement characters where a
        # math glyph could not be decoded. Keeping the placeholder makes the
        # formula look broken in the browser; dropping it is safer than
        # guessing a missing operator.
        .replace("\ufffc", "")
        .replace("\ufffd", "")
        .replace("\uffff", "")
    )
    text = re.sub(r"[ \t]+", " ", text)
    # Common PDF extraction splits in these generated handouts.
    text = re.sub(r"\bT\s+(?=ransformer|oken|arget|ask)", "T", text)
    text = re.sub(r"\bBAR\s+T\b", "BART", text)
    text = repair_math_extraction(text)
    text = re.sub(r"\s+([，。；：！？、）】])", r"\1", text)
    text = re.sub(r"([（【])\s+", r"\1", text)
    return text.strip()


def repair_math_extraction(text: str) -> str:
    """Make formulas flattened by PDF extraction readable in one line.

    The source PDFs contain two-dimensional math. Text extraction often emits a
    numerator followed by a denominator with only a space between them, drops
    superscript positions, and separates square-root operands. These rules are
    intentionally conservative and target recurring patterns in the handouts.
    """
    # Root signs and exponentials.
    text = re.sub(r"√\s+", "√", text)
    text = re.sub(r"\b𝑒\s+([0-9]+(?:\.[0-9]+)?)", r"𝑒^\1", text)
    text = re.sub(r"\be\s+([0-9]+(?:\.[0-9]+)?)", r"e^\1", text)

    # Transpose and scaled dot-product attention fractions.
    text = re.sub(r"𝑄𝐾𝑇", "𝑄𝐾^T", text)
    text = re.sub(r"𝐾𝑇", "𝐾^T", text)
    text = re.sub(r"(𝑄𝐾(?:\^T|⊤))\s*/?\s*(√𝑑𝑘)", r"\1/\2", text)
    text = re.sub(r"softmax\(\s*([^()]*?𝑄𝐾(?:\^T|⊤)/√𝑑𝑘)\s*\)", r"softmax(\1)", text)

    # Common fraction formulas in the generated exercises.
    text = text.replace("𝑅 1−𝛾", "𝑅/(1−𝛾)")
    text = text.replace("𝑅 1−𝛾", "𝑅/(1−𝛾)")
    text = text.replace("𝑥−𝜇 𝜎", "(𝑥−𝜇)/𝜎")
    text = text.replace("Target − 𝑄𝑜𝑙𝑑", "Target − 𝑄_old")
    text = text.replace("𝑄 𝑜𝑙𝑑", "𝑄_old")
    text = text.replace("𝑄𝑜𝑙𝑑", "𝑄_old")
    text = text.replace("𝑄 𝑛𝑒𝑤", "𝑄_new")
    text = text.replace("𝑄𝑛𝑒𝑤", "𝑄_new")
    text = text.replace("𝑉𝑛𝑒𝑤", "𝑉_new")
    text = text.replace("2 10/3", "2/(10/3)")

    # Superscript 2 is often extracted as a normal trailing "2".
    text = re.sub(r"\b(0\.\d+)\s+2(?=\s*[×*+\-−=,，。)]|$)", r"\1^2", text)
    text = re.sub(r"(𝛾)\s*2(?=\s*(?:𝑅|R|[×*+\-−=,，。)]|$))", r"\1^2", text)
    text = re.sub(r"(\([^()]+\))2\b", r"\1^2", text)

    # Small inline fractions that appear as answers or vector components.
    def frac_repl(match: re.Match[str]) -> str:
        numerator = match.group(1)
        denominator = match.group(2)
        if denominator == "0":
            return match.group(0)
        return f"{numerator}/{denominator}"

    text = re.sub(r"^([−-]?\d{1,2})\s+([2-9])$", frac_repl, text)
    text = re.sub(r"^([−-]?\d{1,2})\s+([1-9]\d)$", frac_repl, text)
    text = re.sub(r"(?<=[+\-−×*/=\[,(（，：:\s])([−-]?\d{1,2})\s+([2-9])(?=\s*[+\-−×*/≈,，\]\)）。;；=]|$)", frac_repl, text)
    text = re.sub(r"(?<=[+\-−×*/=\[,(（，：:\s])([−-]?\d{1,2})\s+([1-9]\d)(?=\s*[+\-−×*/≈,，\]\)）。;；=]|$)", frac_repl, text)
    text = re.sub(r"\b1\s+4(?=\s*\()", "1/4", text)
    text = re.sub(r"为1\s+4(?=\s*\()", "为 1/4", text)
    text = text.replace("𝛼2 = 2 4+2+1 = 7", "𝛼2 = 2/(4+2+1) = 2/7")

    # Mean / standard-deviation formulas extracted from stacked fractions.
    def root_fraction_repl(match: re.Match[str]) -> str:
        numerator, denominator = match.groups()
        # Match the parenthesized operand once, then check for an internal
        # plus. Nested overlapping repetitions caused exponential backtracking
        # when a closing parenthesis was missing. Preserve the old requirement
        # of at least one character on either side of the plus.
        if "+" not in numerator[1:-1]:
            return match.group(0)
        return f"√(({numerator})/{denominator})"

    text = re.sub(r"([0-9]+(?:\+[0-9]+)+)\s+([2-9])\s*=", r"(\1)/\2 =", text)
    text = re.sub(r"√([^=。；]+?)\s+([2-9])\s*=", r"√((\1)/\2) =", text)
    text = re.sub(r"√\(([^()]+)\)/([2-9])", root_fraction_repl, text)
    text = re.sub(r"\b([0-9]+(?:\+[0-9]+)+)\+([0-9]+)/([2-9])\s*=", r"(\1+\2)/\3 =", text)
    text = re.sub(r"√([0-9]+(?:\+[0-9]+)+)\+([0-9]+)/([2-9])", r"√((\1+\2)/\3)", text)
    text = re.sub(r"([−-]?\d+)−(\d+)\s+([0-9]+(?:\.[0-9]+)?)", r"(\1−\2)/\3", text)
    text = re.sub(r"/\s+√", "/√", text)
    text = re.sub(r"√\(([^()]+)\)/([2-9])", root_fraction_repl, text)

    return text


def is_running_header(line: str, title_hint: str) -> bool:
    """Return True for page headers such as "大模型介绍 12".

    These PDFs use two header styles:
    - a bare page number on the first physical line;
    - a repeated title followed by the page number.

    The second style is dangerous when a question/explanation continues across
    a page boundary because the header is otherwise appended into the previous
    question text.
    """
    value = compact(line)
    if not value:
        return False
    if re.fullmatch(r"\d{1,3}", value):
        return True
    if not re.search(r"\s\d{1,3}$", value):
        return False
    if QUESTION_RE.match(value) or OPTION_RE.match(value) or ANSWER_RE.match(value) or EXPLANATION_RE.match(value):
        return False
    body = re.sub(r"\s\d{1,3}$", "", value).strip()
    if not body:
        return False
    header_words = ("题库", "全题库", "大模型", "强化学习", "人工智能", "神经网络", "Transformer")
    return bool(title_hint and body.startswith(title_hint)) or any(word in body for word in header_words)


def detect_type(section: str, options: list[dict[str, str]], answer: str) -> str:
    if "判断" in section:
        return "判断题"
    if "填空" in section:
        return "填空题"
    if "简答" in section or "问答" in section:
        return "简答题"
    if "计算" in section:
        return "计算题"
    if options:
        return "选择题"
    if compact(answer) in {"正确", "错误", "对", "错", "√", "×"}:
        return "判断题"
    return "填空题"


def ensure_blank_marker(prompt: str, qtype: str) -> str:
    """Restore fill-in markers lost by PDF extraction."""
    if qtype not in {"填空题", "计算题", "简答题"}:
        return prompt
    if re.search(r"(?:_{2,}|＿{2,})", prompt):
        return prompt
    prompt = re.sub(r"(=\s*)([。？?，,；;])", r"\1______\2", prompt)
    prompt = re.sub(r"(为\s*)([。？?，,；;])", r"\1______\2", prompt)
    prompt = re.sub(r"(越)\s*([，,。；;])", r"\1 ______\2", prompt)
    prompt = re.sub(r"(小于|大于|等于|称为|约为|满足|位于|变为|反映|选择动作)\s*([。？?，,；;])", r"\1 ______\2", prompt)
    prompt = re.sub(r"(填[”\"']?[）)]?)\s*([，,。；;])", r"\1 ______\2", prompt)
    prompt = re.sub(r"(的)\s{1,}(可以|现象|区域|正则化|网络|参数量|参\s*数量|方向|状态|影响|倍|特征值)", r"\1 ______ \2", prompt)
    prompt = re.sub(r"(更)\s{1,}([（(])", r"\1 ______ \2", prompt)
    if re.search(r"(?:_{2,}|＿{2,})", prompt):
        return prompt

    # Last-resort fallback: some PDFs omit the fill line completely. Keeping an
    # explicit blank at the end is less ambiguous than showing a fill-in problem
    # with no visible answer slot.
    end_match = re.search(r"([。？?])(?:\s*[•·●▪])?\s*$", prompt)
    if end_match:
        return prompt[: end_match.start(1)] + " ______" + prompt[end_match.start(1) :]
    return prompt + " ______"


def clean_fragments(
    parts: list[str], title_hint: str, *, drop_page_numbers: bool = True
) -> str:
    kept: list[str] = []
    dropped_numbers: list[str] = []
    for raw in parts:
        value = compact(raw)
        if not value:
            continue
        if drop_page_numbers and re.fullmatch(r"\d{1,3}", value):
            # Looks like a stray page number, but a short numeric value can also
            # be a legitimate field (e.g. an option whose text is just "3").
            # Defer it: only drop it if other real content survives.
            dropped_numbers.append(value)
            continue
        # Repeated running headers usually end in the printed page number.
        if title_hint and value.startswith(title_hint) and re.search(r"\s\d{1,3}$", value):
            continue
        kept.append(value)
    if not kept and dropped_numbers:
        kept = dropped_numbers
    return compact(" ".join(kept))


def expand_inline_options(options: list[dict[str, list[str]]]) -> list[dict[str, list[str]]]:
    """Recover options that PDF extraction collapsed onto one physical line."""
    if len(options) != 1:
        return options
    first = options[0]
    text = compact(" ".join(first["parts"]))
    markers = list(re.finditer(r"(?<![A-Za-z])([B-H])[.．]\s*", text))
    if len(markers) < 2:
        return options

    expanded = [{"key": first["key"], "parts": [text[: markers[0].start()].strip()]}]
    for index, marker in enumerate(markers):
        end = markers[index + 1].start() if index + 1 < len(markers) else len(text)
        expanded.append({"key": marker.group(1), "parts": [text[marker.end() : end].strip()]})
    return expanded


def parse_pdf(path: Path, document_index: int) -> list[dict]:
    from pypdf import PdfReader

    reader = PdfReader(path)
    title_hint = path.stem.split("-")[-1].replace("第", "")
    lines: list[tuple[int, str]] = []
    for page_no, page in enumerate(reader.pages, start=1):
        seen_content = False
        for raw_line in (page.extract_text() or "").splitlines():
            line = compact(raw_line)
            # The first non-empty line of a page is the printed page-number
            # header (sometimes a title plus page number). Drop it here so it
            # cannot leak into an option, prompt, answer, or explanation that
            # wraps across the page boundary.
            if not seen_content and line:
                seen_content = True
                if is_running_header(line, title_hint):
                    continue
            inline_answer = re.match(
                r"^(.+?)\s+[•·●▪]?\s*((?:参考)?答案\s*[：:].*)$", line
            )
            if inline_answer:
                lines.append((page_no, compact(inline_answer.group(1))))
                lines.append((page_no, compact(inline_answer.group(2))))
            else:
                lines.append((page_no, line))

    section = ""
    questions: list[dict] = []
    current: dict | None = None
    phase = "question"

    def finish() -> None:
        nonlocal current
        if not current or not current["answer_parts"]:
            current = None
            return

        prompt = clean_fragments(current["prompt_parts"], title_hint)
        answer = clean_fragments(
            current["answer_parts"], title_hint, drop_page_numbers=False
        )
        explanation = clean_fragments(current["explanation_parts"], title_hint)
        raw_options = expand_inline_options(current["options"])
        options = [
            {"key": item["key"], "text": clean_fragments(item["parts"], title_hint)}
            for item in raw_options
        ]
        if not prompt or not answer:
            current = None
            return

        qtype = detect_type(current["section"], options, answer)
        prompt = ensure_blank_marker(prompt, qtype)
        questions.append(
            {
                "id": f"d{document_index + 1}-q{len(questions) + 1}",
                "documentIndex": document_index,
                "document": path.name,
                "pdf": path.name,
                "number": current["number"],
                "page": current["page"],
                "section": current["section"] or qtype,
                "type": qtype,
                "prompt": prompt,
                "options": options,
                "answer": answer,
                "explanation": explanation,
            }
        )
        current = None

    for page_no, line in lines:
        if not line:
            continue

        heading = SECTION_RE.match(line)
        if heading and not re.match(r"^\d", heading.group(1)):
            candidate = compact(heading.group(1))
            if any(word in candidate for word in ("选择", "判断", "填空", "简答", "问答", "计算")):
                section = candidate
                continue

        answer_match = ANSWER_RE.match(line)
        explanation_match = EXPLANATION_RE.match(line)
        question_match = QUESTION_RE.match(line)
        option_match = OPTION_RE.match(line)

        if question_match and (current is None or current["answer_parts"]):
            finish()
            current = {
                "number": int(question_match.group(1)),
                "page": page_no,
                "section": section,
                "prompt_parts": [question_match.group(2)],
                "options": [],
                "answer_parts": [],
                "explanation_parts": [],
            }
            phase = "question"
            continue

        if current is None:
            continue
        if answer_match:
            current["answer_parts"].append(answer_match.group(1))
            phase = "answer"
            continue
        if explanation_match:
            current["explanation_parts"].append(explanation_match.group(1))
            phase = "explanation"
            continue
        if option_match and phase == "question":
            current["options"].append({"key": option_match.group(1), "parts": [option_match.group(2)]})
            continue

        if phase == "question":
            if current["options"]:
                current["options"][-1]["parts"].append(line)
            else:
                current["prompt_parts"].append(line)
        elif phase == "answer":
            current["answer_parts"].append(line)
        else:
            current["explanation_parts"].append(line)

    finish()
    return questions


def main() -> None:
    pdfs = sorted(ROOT.glob("*.pdf"))
    if not pdfs:
        raise SystemExit("No PDF files found.")

    questions: list[dict] = []
    documents: list[dict] = []
    for document_index, pdf in enumerate(pdfs):
        parsed = parse_pdf(pdf, document_index)
        documents.append(
            {
                "index": document_index,
                "name": pdf.name,
                "questionCount": len(parsed),
            }
        )
        questions.extend(parsed)

    payload = {
        "generatedFrom": [pdf.name for pdf in pdfs],
        "documents": documents,
        "questions": questions,
    }
    OUTPUT.write_text(
        "window.QUESTION_BANK = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )

    type_counts: dict[str, int] = {}
    for question in questions:
        type_counts[question["type"]] = type_counts.get(question["type"], 0) + 1
    print(f"Wrote {len(questions)} questions to {OUTPUT.name}")
    for document in documents:
        print(f"  {document['name']}: {document['questionCount']}")
    print("Types:", type_counts)


if __name__ == "__main__":
    main()
