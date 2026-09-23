// 앱 상태와 함수를 외부 전역 영역에 노출하지 않습니다.
(() => {
  "use strict";
  
  const TODOS_KEY = "todos";
  const CATEGORIES_KEY = "categories";
  const LEGACY_TODOS_KEY = "daily-todo.todos.v1";
  const todos = [];
  let nextId = 1;
  let editingId = null;
  let editingCategoryId = null;
  // null은 전체 필터입니다. 사용자 카테고리 id와 충돌하지 않습니다.
  let selectedCategoryId = null;
  const categories = [];
  const defaultCategories = [
    { id: "work", name: "업무" },
    { id: "personal", name: "개인" },
    { id: "study", name: "공부" }
  ];
  let todosWritable = true;
  let categoriesWritable = true;
  const storageMessages = { todos: "", categories: "" };
  const addForm = document.getElementById("add-todo-form");
  const todoInput = document.getElementById("todo-input");
  const categoryInput = document.getElementById("todo-category");
  const todoList = document.getElementById("todo-list");
  let manualCategoryId = null;
  const CLASSIFICATION_KEY = "daily-todo.classification.v1";
  const classificationSettings = { enabled: true, showSuggestions: true };
  const categoryRules = [
    { id: "work", names: ["업무", "회사", "직장", "work"], keywords: ["회의", "보고서", "기획", "결재", "고객", "견적", "출장", "업무", "프로젝트"] },
    { id: "personal", names: ["개인", "생활", "personal"], keywords: ["장보기", "청소", "세탁", "병원", "약속", "가족", "공과금", "예약", "은행"] },
    { id: "study", names: ["공부", "학습", "study"], keywords: ["공부", "강의", "시험", "과제", "복습", "예습", "영어", "독서", "자격증"] },
    { names: ["취업", "구직"], keywords: ["자기소개서", "이력서", "면접", "입사지원", "채용", "포트폴리오"] },
    { names: ["운동", "건강"], keywords: ["운동", "헬스", "러닝", "조깅", "수영", "요가", "스트레칭"] },
    { names: ["여행"], keywords: ["여행", "항공권", "숙소", "호텔", "여권", "여행짐"] }
  ];

  function getCategoryKeywords(category) {
    const name = category.name.trim().toLocaleLowerCase();
    const keywords = new Set([name]);
    for (const rule of categoryRules) {
      if (rule.id === category.id || rule.names.includes(name)) {
        rule.names.forEach(alias => keywords.add(alias));
        rule.keywords.forEach(keyword => keywords.add(keyword));
      }
    }
    return [...keywords];
  }

  function suggestCategory(text) {
    const normalized = text.trim().toLocaleLowerCase();
    if (!normalized) return null;
    const matches = categories.map(category => {
      const score = getCategoryKeywords(category).filter(keyword => {
        // 영문 키워드는 homework와 work 같은 부분 단어 오분류를 피합니다.
        if (/^[a-z0-9 ]+$/.test(keyword)) {
          return normalized.split(/[^a-z0-9]+/).join(" ").split(" ").includes(keyword);
        }
        return normalized.includes(keyword);
      }).length;
      return { category, score };
    }).sort((a, b) => b.score - a.score);
    // 여러 카테고리가 같은 점수면 임의로 선택하지 않습니다.
    if (!matches[0]?.score || matches[0].score === matches[1]?.score) return null;
    return matches[0].category;
  }

  function updateCategorySuggestion() {
    const hint = document.getElementById("category-suggestion");
    hint.hidden = !classificationSettings.showSuggestions;
    if (manualCategoryId && !getCategory(manualCategoryId)) manualCategoryId = null;
    if (!categories.length || !todoInput.value.trim()) {
      hint.textContent = classificationSettings.enabled
        ? "내용의 키워드로 카테고리를 자동 선택합니다. 직접 변경할 수 있습니다."
        : "자동 분류가 꺼져 있습니다. 카테고리를 직접 선택하세요.";
      return;
    }
    if (manualCategoryId) {
      hint.textContent = `직접 선택한 '${getCategory(manualCategoryId).name}' 카테고리를 사용합니다.`;
      return;
    }
    const suggestion = suggestCategory(todoInput.value);
    if (suggestion) {
      if (classificationSettings.enabled) categoryInput.value = suggestion.id;
      hint.textContent = classificationSettings.enabled
        ? `키워드에 따라 '${suggestion.name}' 카테고리를 자동 선택했습니다.`
        : `추천 카테고리: '${suggestion.name}'. 자동 분류가 꺼져 있어 직접 선택해야 합니다.`;
    } else {
      hint.textContent = "일치하는 분류가 없거나 여러 분류가 비슷합니다. 현재 카테고리를 확인해주세요.";
    }
  }

  function loadClassificationSettings() {
    try {
      const raw = localStorage.getItem(CLASSIFICATION_KEY);
      if (raw === null) return;
      const saved = JSON.parse(raw);
      if (!saved || typeof saved.enabled !== "boolean" || typeof saved.showSuggestions !== "boolean") throw new Error();
      Object.assign(classificationSettings, { enabled: saved.enabled, showSuggestions: saved.showSuggestions });
    } catch {
      document.getElementById("classification-status").textContent = "설정을 읽지 못해 기본값(ON)을 사용합니다.";
    }
  }

  function saveClassificationSettings() {
    try {
      localStorage.setItem(CLASSIFICATION_KEY, JSON.stringify(classificationSettings));
      document.getElementById("classification-status").textContent = "설정을 저장했습니다.";
    } catch {
      document.getElementById("classification-status").textContent = "설정을 저장하지 못했습니다. 현재 페이지에서만 적용됩니다.";
    }
  }

  function renderKeywordPreview() {
    const list = document.getElementById("keyword-preview");
    list.replaceChildren();
    for (const category of categories) {
      const item = makeElement("li", "");
      item.append(makeElement("strong", "", `${category.name}: `),
        makeElement("span", "", getCategoryKeywords(category).join(", ")));
      list.append(item);
    }
    if (!categories.length) list.append(makeElement("li", "", "사용 가능한 카테고리가 없습니다."));
  }
  const dateInput = document.getElementById("todo-date");
  const dueDateInput = document.getElementById("todo-due-date");
  let selectedDate = localDateString(new Date());
  let calendarYear = Number(selectedDate.slice(0, 4));
  let calendarMonth = Number(selectedDate.slice(5, 7)) - 1;

  function localDateString(date) {
    return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function isValidDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1) return false;
    const date = new Date(2000, month - 1, day);
    date.setFullYear(year);
    return localDateString(date) === value;
  }

  function getTodosByDate(date) {
    return todos.filter(todo => isTodoVisibleOnDate(todo, date));
  }

  function isTodoVisibleOnDate(todo, date) {
    return todo.dueDate ? todo.date <= date && date <= todo.dueDate : todo.date === date;
  }

  function validateDueDate(input, startDate) {
    const valid = !input.value || (isValidDate(input.value) && input.value >= startDate);
    input.setCustomValidity(valid ? "" : "D-day는 시작 날짜와 같거나 이후인 날짜를 선택하세요.");
    if (!valid) input.reportValidity();
    return valid;
  }

  // 달력 날짜를 정수 일수로 계산해 시간대와 서머타임의 영향을 피합니다.
  function calendarDayNumber(value) {
    let [year, month, day] = value.split("-").map(Number);
    if (month <= 2) year--;
    const era = Math.floor(year / 400);
    const y = year - era * 400;
    const m = month + (month > 2 ? -3 : 9);
    return era * 146097 + y * 365 + Math.floor(y / 4) - Math.floor(y / 100) +
      Math.floor((153 * m + 2) / 5) + day - 1;
  }

  function getDdayLabel(dueDate, date = selectedDate) {
    const remaining = calendarDayNumber(dueDate) - calendarDayNumber(date);
    return remaining === 0 ? "D-DAY" : `D-${remaining}`;
  }

  function getFilteredTodos() {
    return getTodosByDate(selectedDate).filter(todo =>
      selectedCategoryId === null || todo.categoryId === selectedCategoryId);
  }

  function selectCategoryFilter(id) {
    if (id !== null && !getCategory(id)) return;
    if (editingId !== null) saveEditedTodo(editingId, true);
    selectedCategoryId = id;
    renderCategoryFilters();
    renderTodos();
  }

  function renderCategoryFilters() {
    if (selectedCategoryId !== null && !getCategory(selectedCategoryId)) selectedCategoryId = null;
    const container = document.getElementById("category-filters");
    container.replaceChildren();
    for (const category of [{ id: null, name: "전체" }, ...categories]) {
      const active = category.id === selectedCategoryId;
      const button = makeButton(category.name, () => {
        selectCategoryFilter(category.id);
        const index = category.id === null ? 0 : categories.findIndex(item => item.id === category.id) + 1;
        container.children[index]?.focus();
      }, `category-filter${active ? " active" : ""}`);
      button.setAttribute("aria-pressed", String(active));
      container.append(button);
    }
  }

  function selectDate(date) {
    if (!isValidDate(date)) return;
    if (editingId !== null) saveEditedTodo(editingId, true);
    selectedDate = date;
    calendarYear = Number(date.slice(0, 4));
    calendarMonth = Number(date.slice(5, 7)) - 1;
    dateInput.value = date;
    dateInput.setCustomValidity("");
    renderCalendar();
    renderTodos();
    updateProgress();
  }

  // 편집 입력의 blur 저장 중 날짜 버튼을 교체하면 이어지는 클릭이 사라질 수 있습니다.
  // D-day 변경 시에는 기존 날짜 버튼을 유지하고 개수만 갱신합니다.
  function updateCalendarCounts() {
    const today = localDateString(new Date());
    for (const button of document.getElementById("calendar-days").querySelectorAll(".calendar-day")) {
      const date = button.id.slice("calendar-".length);
      const count = getTodosByDate(date).length;
      button.setAttribute("aria-label", `${date}, 할 일 ${count}개${date === today ? ", 오늘" : ""}`);
      const badge = button.querySelector(".calendar-count");
      if (!count) badge?.remove();
      else if (badge) badge.textContent = `•${count}`;
      else button.append(makeElement("span", "calendar-count", `•${count}`));
    }
  }

  function changeMonth(offset) {
    const monthIndex = calendarYear * 12 + calendarMonth + offset;
    const year = Math.floor(monthIndex / 12);
    if (year < 1 || year > 9999) return;
    calendarYear = year;
    calendarMonth = monthIndex % 12;
    renderCalendar();
  }

  function renderCalendar() {
    document.getElementById("calendar-month").textContent = `${calendarYear}년 ${calendarMonth + 1}월`;
    const grid = document.getElementById("calendar-days");
    grid.replaceChildren();
    const first = new Date(2000, calendarMonth, 1);
    first.setFullYear(calendarYear);
    const last = new Date(first);
    last.setMonth(last.getMonth() + 1, 0);
    const today = localDateString(new Date());
    for (let i = 0; i < first.getDay(); i++) {
      const blank = makeElement("span", "calendar-blank");
      blank.setAttribute("aria-hidden", "true");
      grid.append(blank);
    }
    for (let day = 1; day <= last.getDate(); day++) {
      const date = `${String(calendarYear).padStart(4, "0")}-${String(calendarMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const count = getTodosByDate(date).length;
      const button = makeButton(String(day), () => {
        selectDate(date);
        document.getElementById(`calendar-${date}`).focus();
      }, `calendar-day${date === today ? " is-today" : ""}${date === selectedDate ? " is-selected" : ""}`);
      button.id = `calendar-${date}`;
      button.setAttribute("aria-label", `${date}, 할 일 ${count}개${date === today ? ", 오늘" : ""}`);
      button.setAttribute("aria-pressed", String(date === selectedDate));
      if (date === today) button.setAttribute("aria-current", "date");
      if (count) button.append(makeElement("span", "calendar-count", `•${count}`));
      grid.append(button);
    }
    document.getElementById("calendar-prev").disabled = calendarYear === 1 && calendarMonth === 0;
    document.getElementById("calendar-next").disabled = calendarYear === 9999 && calendarMonth === 11;
  }
  
  function showStorageMessage(scope, message = "") {
    storageMessages[scope] = message;
    const notice = document.getElementById("storage-message");
    notice.textContent = Object.values(storageMessages).filter(Boolean).join(" ");
    notice.hidden = !notice.textContent;
  }

  function getCategory(id) {
    return categories.find(category => category.id === id);
  }

  // 같은 시각에 생성하더라도 기존 ID와 충돌하지 않습니다.
  function createCategoryId() {
    const base = `category-${Date.now()}`;
    let id = base;
    let suffix = 1;
    while (getCategory(id)) id = `${base}-${suffix++}`;
    return id;
  }

  function loadCategories() {
    categories.length = 0;
    try {
      const raw = localStorage.getItem(CATEGORIES_KEY);
      if (raw === null) {
        categories.push(...defaultCategories.map(category => ({ ...category })));
        saveCategories();
        return;
      }
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved)) throw new Error("Invalid categories");
      const ids = new Set();
      for (const category of saved) {
        if (!category || typeof category.id !== "string" || !category.id.trim() ||
            typeof category.name !== "string" || !category.name.trim() || ids.has(category.id)) {
          throw new Error("Invalid category");
        }
        ids.add(category.id);
      }
      // 기존 버전이 저장한 추가 속성도 다음 저장 때 유실되지 않게 보존합니다.
      categories.push(...saved.map(category => ({ ...category })));
      // []는 사용자가 모두 삭제한 상태이며 기본값으로 대체하지 않습니다.
    } catch {
      categoriesWritable = false;
      showStorageMessage("categories", "카테고리를 읽지 못했습니다. 기존 저장값을 보호하며 카테고리가 복구될 때까지 새 Todo를 추가할 수 없습니다.");
    }
  }

  function saveCategories() {
    if (!categoriesWritable) return false;
    try {
      localStorage.setItem(CATEGORIES_KEY, JSON.stringify(categories));
      showStorageMessage("categories");
      return true;
    } catch {
      showStorageMessage("categories", "카테고리를 저장하지 못했습니다. 브라우저 저장 설정과 여유 공간을 확인하세요.");
      return false;
    }
  }

  function loadTodos() {
    todos.length = 0;
    nextId = 1;
    try {
      const current = localStorage.getItem(TODOS_KEY);
      const raw = current === null ? localStorage.getItem(LEGACY_TODOS_KEY) : current;
      if (raw === null) return;
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved)) throw new Error("Invalid Todo array");
      const ids = new Set();
      const converted = saved.map(todo => {
        const categoryId = todo && (todo.categoryId ?? todo.category);
        if (!todo || !Number.isSafeInteger(todo.id) || todo.id < 1 ||
            todo.id >= Number.MAX_SAFE_INTEGER || ids.has(todo.id) ||
            typeof todo.text !== "string" || !todo.text.trim() ||
            typeof categoryId !== "string" || !categoryId.trim() ||
            typeof todo.completed !== "boolean" ||
            typeof todo.createdAt !== "string" || !Number.isFinite(Date.parse(todo.createdAt))) {
          throw new Error("Invalid Todo data");
        }
        ids.add(todo.id);
        // 존재하지 않는 카테고리 참조도 보존하여 Todo 손실을 방지합니다.
        const { category, ...rest } = todo;
        const date = isValidDate(todo.date) ? todo.date : localDateString(new Date());
        const dueDate = isValidDate(todo.dueDate) && todo.dueDate >= date ? todo.dueDate : null;
        return { ...rest, categoryId, date, dueDate };
      });
      todos.push(...converted);
      for (const todo of todos) nextId = Math.max(nextId, todo.id + 1);
      const needsMigration = current === null || saved.some((todo, index) =>
        Object.hasOwn(todo, "category") || !Object.hasOwn(todo, "categoryId") || !isValidDate(todo.date) ||
        !Object.hasOwn(todo, "dueDate") || todo.dueDate !== converted[index].dueDate);
      if (needsMigration) saveTodos();
      // 이전 키는 백업으로 남깁니다. 새 키가 []여도 이전 데이터를 복원하지 않습니다.
    } catch {
      todosWritable = false;
      showStorageMessage("todos", "Todo를 읽지 못해 빈 목록으로 시작합니다. 원본 보호를 위해 저장을 중지했습니다. 저장 데이터를 복구한 뒤 새로고침하세요.");
    }
  }

  function saveTodos() {
    if (!todosWritable) return false;
    try {
      localStorage.setItem(TODOS_KEY, JSON.stringify(todos));
      showStorageMessage("todos");
      return true;
    } catch {
      showStorageMessage("todos", "Todo를 저장하지 못했습니다. 현재 변경은 이 페이지에서만 유지됩니다. 기존 저장값은 그대로 남아 있습니다.");
      return false;
    }
  }

  function fillCategoryOptions(select, selectedId) {
    select.replaceChildren();
    for (const category of categories) {
      const option = makeElement("option", "", category.name);
      option.value = category.id;
      select.append(option);
    }
    if (selectedId && !getCategory(selectedId)) {
      const missing = makeElement("option", "", "삭제되었거나 알 수 없는 카테고리");
      missing.value = selectedId;
      select.append(missing);
    }
    select.value = selectedId || categories[0]?.id || "";
    select.disabled = categories.length === 0;
  }

  function renderCategories() {
    const selectedId = getCategory(categoryInput.value) ? categoryInput.value : undefined;
    fillCategoryOptions(categoryInput, selectedId);
    document.getElementById("add-todo-button").disabled = categories.length === 0;
    document.getElementById("category-empty-message").hidden = categories.length > 0;
    renderCategoryList();
    renderCategoryFilters();
    updateCategorySuggestion();
    renderKeywordPreview();
  }

  function validateCategoryName(input, excludedId = null) {
    const name = input.value.trim();
    const duplicate = categories.some(category => category.id !== excludedId &&
      category.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
    input.setCustomValidity(!name ? "카테고리 이름을 입력하세요." :
      duplicate ? "이미 같은 이름의 카테고리가 있습니다." : "");
    if (!name || duplicate) {
      input.reportValidity();
      return null;
    }
    return name;
  }

  function addCategory() {
    if (!categoriesWritable) return;
    const input = document.getElementById("category-name-input");
    const name = validateCategoryName(input);
    if (!name) return;
    categories.push({ id: createCategoryId(), name });
    saveCategories();
    input.value = "";
    renderCategories();
    renderTodos();
    input.focus();
  }

  function editCategory(id, input) {
    if (!categoriesWritable) return;
    const category = getCategory(id);
    const name = validateCategoryName(input, id);
    if (!category || !name) return;
    category.name = name;
    editingCategoryId = null;
    saveCategories();
    renderCategories();
    renderTodos();
    document.getElementById(`category-edit-${id}`).focus();
  }

  function deleteCategory(id) {
    // 손상된 저장 데이터를 연관 Todo 삭제로 덮어쓰지 않도록 보호합니다.
    if (!categoriesWritable || !todosWritable) return;
    const category = getCategory(id);
    if (!category) return;
    const count = todos.filter(todo => todo.categoryId === id).length;
    const message = count
      ? `'${category.name}' 카테고리를 삭제하면 이 카테고리의 할 일 ${count}개도 함께 삭제됩니다.\n계속하시겠습니까?`
      : `'${category.name}' 카테고리를 삭제하시겠습니까?`;
    if (!window.confirm(message)) return;
    for (let index = todos.length - 1; index >= 0; index--) {
      if (todos[index].categoryId === id) {
        if (editingId === todos[index].id) editingId = null;
        todos.splice(index, 1);
      }
    }
    categories.splice(categories.findIndex(item => item.id === id), 1);
    if (editingCategoryId === id) editingCategoryId = null;
    // Todo 저장 실패 시 카테고리 삭제까지 디스크에 반영하지 않습니다.
    if (saveTodos()) saveCategories();
    else showStorageMessage("categories", "카테고리 삭제를 저장하지 못했습니다. 현재 삭제는 이 페이지에서만 반영되며 새로고침하면 이전 저장값이 다시 나타날 수 있습니다.");
    renderCategories();
    renderTodos();
    updateProgress();
    renderCalendar();
    document.getElementById("category-name-input").focus();
  }

  function renderCategoryList() {
    const list = document.getElementById("category-list");
    const previous = list.querySelector(".category-edit-input");
    const draft = previous && previous.dataset.categoryId === editingCategoryId ? previous.value : null;
    list.replaceChildren();
    for (const category of categories) {
      const item = makeElement("li", "category-item");
      if (editingCategoryId === category.id) {
        item.className += " is-editing";
        const form = makeElement("form", "category-edit-form");
        const input = makeElement("input", "category-edit-input");
        input.id = "category-edit-input";
        input.type = "text";
        input.dataset.categoryId = category.id;
        input.value = draft ?? category.name;
        input.setAttribute("aria-label", "카테고리 이름 수정");
        input.addEventListener("input", () => input.setCustomValidity(""));
        const save = makeElement("button", "todo-action", "저장");
        save.type = "submit";
        const cancel = () => {
          editingCategoryId = null;
          renderCategoryList();
          document.getElementById(`category-edit-${category.id}`).focus();
        };
        const actions = makeElement("div", "todo-actions");
        actions.append(save, makeButton("취소", cancel));
        form.append(input, actions);
        form.addEventListener("submit", event => {
          event.preventDefault();
          editCategory(category.id, input);
        });
        form.addEventListener("keydown", event => {
          if (event.isComposing) return;
          if (event.key === "Escape") { event.preventDefault(); cancel(); }
        });
        item.append(form);
      } else {
        const name = makeElement("span", "category-name", category.name);
        const actions = makeElement("div", "todo-actions");
        const edit = makeButton("✏", () => {
          editingCategoryId = category.id;
          renderCategoryList();
          const input = document.getElementById("category-edit-input");
          input.focus();
          input.select();
        });
        edit.className += " category-icon-button";
        edit.title = "카테고리 수정";
        edit.id = `category-edit-${category.id}`;
        edit.setAttribute("aria-label", `${category.name} 카테고리 수정`);
        edit.disabled = !categoriesWritable;
        const remove = makeButton("🗑", () => deleteCategory(category.id), "todo-action todo-action--delete category-icon-button");
        remove.title = "카테고리 삭제";
        remove.setAttribute("aria-label", `${category.name} 카테고리 삭제`);
        remove.disabled = !categoriesWritable || !todosWritable;
        actions.append(edit, remove);
        item.append(name, actions);
      }
      list.append(item);
    }
    document.getElementById("category-list-empty").hidden = categories.length > 0;
    document.getElementById("add-category-button").disabled = !categoriesWritable;
  }

  function makeCategoryBadge(id) {
    const category = getCategory(id);
    const color = defaultCategories.some(item => item.id === id) ? id : "custom";
    return makeElement("span", `category-badge category-badge--${color}`,
      category ? category.name : "삭제되었거나 알 수 없는 카테고리");
  }
  function commitTodos() {
    saveTodos();
    renderTodos();
    renderCalendar();
    updateProgress();
  }
  
  function validateText(input) {
    const text = input.value.trim();
    input.setCustomValidity(text ? "" : "할 일 내용을 입력하세요.");
    if (!text) input.reportValidity();
    return text;
  }
  
  function addTodo() {
    updateCategorySuggestion();
    const text = validateText(todoInput);
    if (!text || !getCategory(categoryInput.value)) return;
    dateInput.setCustomValidity(isValidDate(dateInput.value) ? "" : "올바른 날짜를 선택하세요.");
    if (!isValidDate(dateInput.value)) { dateInput.reportValidity(); return; }
    if (!validateDueDate(dueDateInput, dateInput.value)) return;
    if (editingId !== null) saveEditedTodo(editingId, true);
    // 매우 큰 저장 id를 읽은 경우에도 안전한 정수와 고유성을 유지합니다.
    if (nextId >= Number.MAX_SAFE_INTEGER) nextId = 1;
    while (todos.some(todo => todo.id === nextId)) nextId++;
    const now = new Date();
    todos.push({
      id: nextId++,
      text,
      categoryId: categoryInput.value,
      date: dateInput.value,
      dueDate: dueDateInput.value || null,
      completed: false,
      createdAt: now.toISOString()
    });
    todoInput.value = "";
    dueDateInput.value = "";
    manualCategoryId = null;
    updateCategorySuggestion();
    // 별도 날짜로 추가한 항목도 바로 확인할 수 있도록 선택 날짜를 맞춥니다.
    selectedDate = dateInput.value;
    calendarYear = Number(selectedDate.slice(0, 4));
    calendarMonth = Number(selectedDate.slice(5, 7)) - 1;
    commitTodos();
    todoInput.focus();
  }
  
  function startEditingTodo(id) {
    if (editingId === id) return;
    if (editingId !== null) saveEditedTodo(editingId, true);
    editingId = id;
    replaceTodoRow(id);
    const input = document.getElementById(`edit-text-${id}`);
    input.focus();
    input.select();
  }

  function saveEditedTodo(id, revertEmpty = false, restoreFocus = false) {
    if (editingId !== id) return;
    const todo = todos.find(item => item.id === id);
    const input = document.getElementById(`edit-text-${id}`);
    if (!todo || !input) return;
    const text = input.value.trim();
    if (!text) {
      if (revertEmpty) cancelEditingTodo(id, restoreFocus);
      else validateText(input);
      return;
    }
    const dueInput = document.getElementById(`edit-due-${id}`);
    if (!validateDueDate(dueInput, todo.date)) {
      if (revertEmpty) cancelEditingTodo(id, restoreFocus);
      return;
    }
    const dueChanged = todo.dueDate !== (dueInput.value || null);
    todo.dueDate = dueInput.value || null;
    todo.text = text;
    const selectedId = document.getElementById(`edit-category-${id}`).value;
    if (getCategory(selectedId)) todo.categoryId = selectedId;
    saveTodos();
    editingId = null;
    if (!isTodoVisibleOnDate(todo, selectedDate) || (selectedCategoryId !== null && todo.categoryId !== selectedCategoryId)) {
      document.getElementById(`todo-row-${id}`)?.remove();
      updateEmptyState();
    } else {
      replaceTodoRow(id);
    }
    if (dueChanged) { updateCalendarCounts(); updateProgress(); }
    if (restoreFocus) (document.getElementById(`edit-button-${id}`) || todoInput).focus();
  }

  function cancelEditingTodo(id, restoreFocus = true) {
    if (editingId !== id) return;
    editingId = null;
    replaceTodoRow(id);
    if (restoreFocus) document.getElementById(`edit-button-${id}`).focus();
  }

  // 편집 종료 시 해당 행만 교체하여 외부 클릭의 대상이 사라지지 않게 합니다.
  function replaceTodoRow(id) {
    const todo = todos.find(item => item.id === id);
    const row = document.getElementById(`todo-row-${id}`);
    if (todo && row) row.replaceWith(createTodoRow(todo));
  }
  function deleteTodo(id) {
    const index = todos.findIndex(item => item.id === id);
    if (index === -1) return;
    todos.splice(index, 1);
    if (editingId === id) editingId = null;
    commitTodos();
    const nextTodo = getFilteredTodos()[0];
    const focusTarget = nextTodo && (
      document.getElementById(`delete-button-${nextTodo.id}`) ||
      document.getElementById(`edit-text-${nextTodo.id}`)
    );
    (focusTarget || todoInput).focus();
  }
  
  function toggleTodo(id) {
    const todo = todos.find(item => item.id === id);
    if (!todo) return;
    todo.completed = !todo.completed;
    commitTodos();
    document.getElementById(`todo-check-${id}`).focus();
  }
  
  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  
  function makeButton(text, action, className = "todo-action") {
    const button = makeElement("button", className, text);
    button.type = "button";
    button.addEventListener("click", action);
    return button;
  }
  
  function createTodoRow(todo) {
    const item = makeElement("li", `todo-item${todo.completed ? " is-completed" : ""}`);
    item.id = `todo-row-${todo.id}`;
    item.dataset.id = todo.id;
    const checkbox = makeElement("input", "todo-checkbox");
    checkbox.type = "checkbox";
    checkbox.id = `todo-check-${todo.id}`;
    checkbox.checked = todo.completed;
    checkbox.setAttribute("aria-label", `${todo.text} 완료`);
    checkbox.addEventListener("change", () => toggleTodo(todo.id));
    const actions = makeElement("div", "todo-actions");

    if (editingId === todo.id) {
      const input = makeElement("input", "todo-inline-input");
      input.type = "text";
      input.id = `edit-text-${todo.id}`;
      input.value = todo.text;
      input.setAttribute("aria-label", "할 일 내용 수정");
      input.addEventListener("input", () => input.setCustomValidity(""));
      const select = makeElement("select", "todo-inline-category");
      select.id = `edit-category-${todo.id}`;
      select.setAttribute("aria-label", "카테고리 수정");
      fillCategoryOptions(select, todo.categoryId);
      const dueLabel = makeElement("label", "todo-due-field", "D-day (선택)");
      const dueInput = makeElement("input", "");
      dueInput.id = `edit-due-${todo.id}`;
      dueInput.type = "date";
      dueInput.min = todo.date;
      dueInput.max = "9999-12-31";
      dueInput.value = todo.dueDate || "";
      dueInput.addEventListener("input", () => dueInput.setCustomValidity(""));
      dueLabel.append(dueInput);
      actions.append(
        makeButton("저장", () => saveEditedTodo(todo.id, false, true)),
        makeButton("취소", () => cancelEditingTodo(todo.id))
      );
      item.className += " is-editing";
      item.append(checkbox, input, select, dueLabel, actions);
      item.addEventListener("keydown", event => {
        // 한글 조합 확정 Enter가 저장으로 처리되지 않게 합니다.
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") {
          event.preventDefault();
          cancelEditingTodo(todo.id);
        } else if (event.key === "Enter" && event.target === input) {
          event.preventDefault();
          saveEditedTodo(todo.id, false, true);
        }
      });
      item.addEventListener("focusout", event => {
        // 카테고리·저장·취소로 이동할 때는 편집을 유지합니다.
        if (item.contains(event.relatedTarget)) return;
        // 삭제된 행의 focusout은 이미 갱신한 상태를 덮어쓰지 않습니다.
        if (item.isConnected) saveEditedTodo(todo.id, true);
      });
    } else {
      // label 클릭으로 완료 상태가 바뀌면 더블클릭 편집과 충돌하므로 분리합니다.
      const text = makeElement("span", "todo-text", todo.text);
      text.title = "더블클릭하여 수정";
      text.addEventListener("dblclick", () => startEditingTodo(todo.id));
      const badge = makeCategoryBadge(todo.categoryId);
      const edit = makeButton("수정", () => startEditingTodo(todo.id));
      edit.id = `edit-button-${todo.id}`;
      edit.setAttribute("aria-label", `${todo.text} 수정`);
      const remove = makeButton("삭제", () => deleteTodo(todo.id), "todo-action todo-action--delete");
      remove.id = `delete-button-${todo.id}`;
      remove.setAttribute("aria-label", `${todo.text} 삭제`);
      actions.append(edit, remove);
      const metadata = makeElement("div", "todo-metadata");
      metadata.append(badge);
      if (todo.dueDate) {
        const dueBadge = makeElement("span", "due-badge", getDdayLabel(todo.dueDate));
        dueBadge.title = `D-day: ${todo.dueDate}`;
        dueBadge.setAttribute("aria-label", `${todo.dueDate} 마감, ${getDdayLabel(todo.dueDate)}`);
        metadata.append(dueBadge);
      }
      item.append(checkbox, text, metadata, actions);
    }
    return item;
  }

  function renderTodos() {
    const input = editingId === null ? null : document.getElementById(`edit-text-${editingId}`);
    const draft = input ? {
      text: input.value,
      category: document.getElementById(`edit-category-${editingId}`).value,
      dueDate: document.getElementById(`edit-due-${editingId}`).value
    } : null;
    const visibleTodos = getFilteredTodos();
    todoList.replaceChildren(...visibleTodos.map(createTodoRow));
    if (draft) {
      document.getElementById(`edit-text-${editingId}`).value = draft.text;
      document.getElementById(`edit-due-${editingId}`).value = draft.dueDate;
      const todo = todos.find(item => item.id === editingId);
      document.getElementById(`edit-category-${editingId}`).value =
        getCategory(draft.category) ? draft.category : todo.categoryId;
    }
    updateEmptyState(visibleTodos);
    const [year, month, day] = selectedDate.split("-").map(Number);
    document.getElementById("todo-list-title").textContent = `${year}년 ${month}월 ${day}일 할 일`;
  }
  function updateEmptyState(visibleTodos = getFilteredTodos()) {
    const message = document.getElementById("todo-empty-message");
    message.hidden = visibleTodos.length > 0;
    const category = getCategory(selectedCategoryId);
    message.textContent = category
      ? `이 날짜의 '${category.name}' 카테고리에 등록된 할 일이 없습니다.`
      : "이 날짜에 등록된 할 일이 없습니다.";
  }

  function updateProgress() {
    const [, month, day] = selectedDate.split("-").map(Number);
    document.getElementById("progress-title").textContent = `${month}월 ${day}일 진행률`;
    const visibleTodos = getTodosByDate(selectedDate);
    const completed = visibleTodos.filter(todo => todo.completed).length;
    const percent = visibleTodos.length ? Math.round(completed / visibleTodos.length * 100) : 0;
    document.getElementById("completed-count").textContent = completed;
    document.getElementById("total-count").textContent = visibleTodos.length;
    document.getElementById("progress-percent").textContent = `${percent}%`;
    const progress = document.getElementById("todo-progress");
    progress.setAttribute("aria-valuenow", String(percent));
    document.getElementById("progress-bar").style.width = `${percent}%`;
  }
  
  addForm.addEventListener("submit", event => {
    event.preventDefault();
    addTodo();
  });
  todoInput.addEventListener("input", () => {
    todoInput.setCustomValidity("");
    if (!todoInput.value.trim()) manualCategoryId = null;
    updateCategorySuggestion();
  });
  categoryInput.addEventListener("change", () => {
    manualCategoryId = categoryInput.value;
    updateCategorySuggestion();
  });
  dateInput.addEventListener("input", () => dateInput.setCustomValidity(""));
  dueDateInput.addEventListener("input", () => dueDateInput.setCustomValidity(""));
  dateInput.addEventListener("input", () => dueDateInput.setCustomValidity(""));
  document.getElementById("calendar-prev").addEventListener("click", () => changeMonth(-1));
  document.getElementById("calendar-next").addEventListener("click", () => changeMonth(1));
  document.getElementById("add-category-form").addEventListener("submit", event => {
    event.preventDefault();
    addCategory();
  });
  document.getElementById("category-name-input").addEventListener("input", event => event.target.setCustomValidity(""));
  loadClassificationSettings();
  const autoToggle = document.getElementById("classification-enabled");
  const suggestionToggle = document.getElementById("classification-suggestions");
  autoToggle.checked = classificationSettings.enabled;
  suggestionToggle.checked = classificationSettings.showSuggestions;
  autoToggle.addEventListener("change", () => {
    classificationSettings.enabled = autoToggle.checked;
    saveClassificationSettings();
    updateCategorySuggestion();
  });
  suggestionToggle.addEventListener("change", () => {
    classificationSettings.showSuggestions = suggestionToggle.checked;
    saveClassificationSettings();
    updateCategorySuggestion();
  });
  loadCategories();
  loadTodos();
  renderCategories();
  dateInput.value = selectedDate;
  renderCalendar();
  renderTodos();
  updateProgress();
})();



