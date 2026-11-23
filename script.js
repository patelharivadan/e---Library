const STORAGE_KEY = "elibrary_books_v3";
const HISTORY_KEY = "elibrary_history_v1";
const FINE_RATE_KEY = "elibrary_fine_rate";
const SESSION_KEY = "elibrary_user";
const DB_NAME = "ELibraryPDFStore";
const STORE_NAME = "pdfs";

const USERS = [
  { username: "admin", password: "admin123", role: "admin", name: "Library Admin" },
  { username: "student", password: "student123", role: "student", name: "Student User" }
];

function formatLocalDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatTimestamp(date) {
  const datePart = formatLocalDate(date);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${datePart} ${hh}:${mm}`;
}

function getTodayStr() {
  return formatLocalDate(new Date());
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

function getDaysUntilDue(dueDateStr) {
  if (!dueDateStr) return null;
  const parts = dueDateStr.split("-").map(Number);
  if (parts.length !== 3) return null;
  const due = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
}

function getOverdueDays(book) {
  if (book.status !== "Borrowed" || !book.dueDate) return 0;
  const diff = getDaysUntilDue(book.dueDate);
  return diff !== null && diff < 0 ? Math.abs(diff) : 0;
}

function isBookOverdue(book) {
  return getOverdueDays(book) > 0;
}

function loadFineRate() {
  try {
    const saved = Number(localStorage.getItem(FINE_RATE_KEY));
    return Number.isFinite(saved) && saved >= 0 ? saved : 10;
  } catch {
    return 10;
  }
}

let dailyFineRate = loadFineRate();

function getLateFee(book) {
  return getOverdueDays(book) * dailyFineRate;
}

const defaultBooks = [
  {
    id: 1,
    title: "Clean Code",
    author: "Robert C. Martin",
    category: "Programming",
    isbn: "978-0132350884",
    status: "Available",
    borrower: "",
    borrowDate: "",
    dueDate: "",
    pdfType: "none",
    pdfUrl: ""
  },
  {
    id: 2,
    title: "Introduction to Algorithms",
    author: "Thomas H. Cormen",
    category: "Programming",
    isbn: "978-0262046305",
    status: "Borrowed",
    borrower: "Aarav Patel",
    borrowDate: addDays(getTodayStr(), -10),
    dueDate: addDays(getTodayStr(), -3),
    pdfType: "none",
    pdfUrl: ""
  },
  {
    id: 3,
    title: "A Brief History of Time",
    author: "Stephen Hawking",
    category: "Science",
    isbn: "978-0553380163",
    status: "Available",
    borrower: "",
    borrowDate: "",
    dueDate: "",
    pdfType: "none",
    pdfUrl: ""
  }
];

const defaultHistory = [
  {
    id: 1001,
    timestamp: `${addDays(getTodayStr(), -10)} 10:30`,
    action: "Borrowed",
    bookTitle: "Introduction to Algorithms",
    isbn: "978-0262046305",
    borrower: "Aarav Patel",
    dueDate: addDays(getTodayStr(), -3),
    fineCollected: 0,
    processedBy: "Library Admin"
  }
];

const memoryPdfMap = new Map();
let activeObjectUrl = null;
let currentUser = null;

function openPdfDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("IndexedDB not supported"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function savePdfBlob(bookId, fileBlob) {
  memoryPdfMap.set(bookId, fileBlob);
  try {
    const db = await openPdfDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(fileBlob, bookId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    // Fallback already stored in memoryPdfMap
  }
}

async function getPdfBlob(bookId) {
  if (memoryPdfMap.has(bookId)) {
    return memoryPdfMap.get(bookId);
  }
  try {
    const db = await openPdfDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(bookId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    return null;
  }
}

async function deletePdfBlob(bookId) {
  memoryPdfMap.delete(bookId);
  try {
    const db = await openPdfDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(bookId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    // Ignore cleanup error
  }
}

function loadBooks() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : [...defaultBooks];
  } catch (error) {
    return [...defaultBooks];
  }
}

function saveBooks() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(books));
}

function loadHistory() {
  try {
    const saved = localStorage.getItem(HISTORY_KEY);
    return saved ? JSON.parse(saved) : [...defaultHistory];
  } catch (error) {
    return [...defaultHistory];
  }
}

function saveHistory() {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(historyLog));
}

let books = loadBooks();
let historyLog = loadHistory();

const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const loginError = document.getElementById("loginError");
const userBadge = document.getElementById("userBadge");
const logoutBtn = document.getElementById("logoutBtn");
const adminSection = document.getElementById("adminSection");
const historySection = document.getElementById("historySection");

const fineRateInput = document.getElementById("fineRateInput");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const bookForm = document.getElementById("bookForm");
const bookList = document.getElementById("bookList");
const searchInput = document.getElementById("searchInput");
const filterCategory = document.getElementById("filterCategory");
const filterStatus = document.getElementById("filterStatus");

const totalBooksEl = document.getElementById("totalBooks");
const availableBooksEl = document.getElementById("availableBooks");
const borrowedBooksEl = document.getElementById("borrowedBooks");
const overdueBooksEl = document.getElementById("overdueBooks");
const totalFinesEl = document.getElementById("totalFines");
const overdueBanner = document.getElementById("overdueBanner");
const overdueBannerText = document.getElementById("overdueBannerText");
const viewOverdueBtn = document.getElementById("viewOverdueBtn");

const historyCountEl = document.getElementById("historyCount");
const collectedFinesTotalEl = document.getElementById("collectedFinesTotal");
const historySearch = document.getElementById("historySearch");
const historyFilterAction = document.getElementById("historyFilterAction");
const historyTableBody = document.getElementById("historyTableBody");
const exportHistoryCsvBtn = document.getElementById("exportHistoryCsvBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");

const borrowModal = document.getElementById("borrowModal");
const borrowModalTitle = document.getElementById("borrowModalTitle");
const borrowForm = document.getElementById("borrowForm");
const borrowBookId = document.getElementById("borrowBookId");
const borrowerNameInput = document.getElementById("borrowerName");
const borrowDueDateInput = document.getElementById("borrowDueDate");
const closeBorrowModalBtn = document.getElementById("closeBorrowModal");
const cancelBorrowBtn = document.getElementById("cancelBorrowBtn");

const pdfModal = document.getElementById("pdfModal");
const pdfModalTitle = document.getElementById("pdfModalTitle");
const pdfOpenNewTab = document.getElementById("pdfOpenNewTab");
const closePdfModal = document.getElementById("closePdfModal");
const pdfFrame = document.getElementById("pdfFrame");

fineRateInput.value = dailyFineRate;

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function csvEscape(value) {
  const str = String(value ?? "");
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function downloadCsv(filename, headers, rows) {
  const csvContent =
    "\uFEFF" + [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function isValidHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function addHistoryEntry({ action, bookTitle, isbn, borrower, dueDate, fineCollected }) {
  historyLog.unshift({
    id: Date.now() + Math.floor(Math.random() * 1000),
    timestamp: formatTimestamp(new Date()),
    action,
    bookTitle,
    isbn,
    borrower,
    dueDate: dueDate || "-",
    fineCollected: Number(fineCollected) || 0,
    processedBy: currentUser ? currentUser.name : "System"
  });
  saveHistory();
  renderHistory();
}

function showAppForUser(user) {
  currentUser = user;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(user));

  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  userBadge.textContent = `${user.name} (${user.role.toUpperCase()})`;

  if (user.role === "admin") {
    adminSection.classList.remove("hidden");
    historySection.classList.remove("hidden");
    renderHistory();
  } else {
    adminSection.classList.add("hidden");
    historySection.classList.add("hidden");
  }

  renderBooks();
}

function showLogin() {
  currentUser = null;
  sessionStorage.removeItem(SESSION_KEY);
  closeReaderModal();
  closeBorrowModal();

  appView.classList.add("hidden");
  loginView.classList.remove("hidden");
  loginForm.reset();
  loginError.classList.add("hidden");
}

loginForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const username = document.getElementById("username").value.trim().toLowerCase();
  const password = document.getElementById("password").value;

  const matchedUser = USERS.find(
    (u) => u.username === username && u.password === password
  );

  if (!matchedUser) {
    loginError.textContent = "Invalid username or password. Please try again.";
    loginError.classList.remove("hidden");
    return;
  }

  loginError.classList.add("hidden");
  showAppForUser(matchedUser);
});

logoutBtn.addEventListener("click", showLogin);

fineRateInput.addEventListener("input", () => {
  const val = Number(fineRateInput.value);
  if (Number.isFinite(val) && val >= 0) {
    dailyFineRate = Math.floor(val);
    localStorage.setItem(FINE_RATE_KEY, String(dailyFineRate));
    renderBooks();
  }
});

exportCsvBtn.addEventListener("click", () => {
  if (!currentUser || currentUser.role !== "admin") return;

  const headers = [
    "Title",
    "Author",
    "Category",
    "ISBN",
    "Status",
    "Borrower",
    "Borrow Date",
    "Due Date",
    "Overdue Days",
    "Late Fee (INR)",
    "PDF Attached"
  ];

  const rows = books.map((book) => {
    const overdueDays = getOverdueDays(book);
    const lateFee = getLateFee(book);
    const displayStatus = overdueDays > 0 ? "Overdue" : book.status;
    const hasPdf = book.pdfType && book.pdfType !== "none" ? "Yes" : "No";

    return [
      book.title,
      book.author,
      book.category,
      book.isbn,
      displayStatus,
      book.borrower || "",
      book.borrowDate || "",
      book.dueDate || "",
      overdueDays,
      lateFee,
      hasPdf
    ];
  });

  downloadCsv(`elibrary-books-${getTodayStr()}.csv`, headers, rows);
});

exportHistoryCsvBtn.addEventListener("click", () => {
  if (!currentUser || currentUser.role !== "admin") return;

  const headers = [
    "Date & Time",
    "Action",
    "Book Title",
    "ISBN",
    "Borrower",
    "Due Date",
    "Fine Collected (INR)",
    "Processed By"
  ];

  const rows = historyLog.map((entry) => [
    entry.timestamp,
    entry.action,
    entry.bookTitle,
    entry.isbn,
    entry.borrower,
    entry.dueDate,
    entry.fineCollected,
    entry.processedBy
  ]);

  downloadCsv(`elibrary-history-${getTodayStr()}.csv`, headers, rows);
});

clearHistoryBtn.addEventListener("click", () => {
  if (!currentUser || currentUser.role !== "admin") return;
  if (historyLog.length === 0) return;
  if (!confirm("Clear all borrow/return history records?")) return;

  historyLog = [];
  saveHistory();
  renderHistory();
});

function updateStats() {
  const total = books.length;
  const available = books.filter((b) => b.status === "Available").length;
  const borrowed = total - available;
  const overdueList = books.filter(isBookOverdue);
  const overdueCount = overdueList.length;
  const totalFines = overdueList.reduce((sum, b) => sum + getLateFee(b), 0);

  totalBooksEl.textContent = total;
  availableBooksEl.textContent = available;
  borrowedBooksEl.textContent = borrowed;
  overdueBooksEl.textContent = overdueCount;
  totalFinesEl.textContent = `₹${totalFines}`;

  if (overdueCount > 0) {
    const bookWord = overdueCount === 1 ? "book is" : "books are";
    overdueBannerText.textContent = `${overdueCount} borrowed ${bookWord} past the due date (Total pending fines: ₹${totalFines}).`;
    overdueBanner.classList.remove("hidden");
  } else {
    overdueBanner.classList.add("hidden");
  }
}

function getDueStatusHtml(book) {
  if (book.status !== "Borrowed" || !book.dueDate) return "";

  const diff = getDaysUntilDue(book.dueDate);
  let statusText = "";
  let statusClass = "";
  let fineHtml = "";

  if (diff < 0) {
    const lateDays = Math.abs(diff);
    const fee = getLateFee(book);
    statusText = `Overdue by ${lateDays} ${lateDays === 1 ? "day" : "days"}`;
    statusClass = "due-text-overdue";
    fineHtml = `<p><span class="fine-pill">Late Fee: ₹${fee} (₹${dailyFineRate}/day)</span></p>`;
  } else if (diff === 0) {
    statusText = "Due today";
    statusClass = "due-text-soon";
  } else if (diff <= 2) {
    statusText = `Due in ${diff} ${diff === 1 ? "day" : "days"}`;
    statusClass = "due-text-soon";
  } else {
    statusText = `Due in ${diff} days`;
  }

  return `
    <p><strong>Due Date:</strong> ${escapeHtml(book.dueDate)}
      <span class="${statusClass}">(${statusText})</span>
    </p>
    ${fineHtml}
  `;
}

function renderBooks() {
  const query = searchInput.value.trim().toLowerCase();
  const category = filterCategory.value;
  const status = filterStatus.value;

  const filtered = books.filter((book) => {
    const matchesSearch =
      book.title.toLowerCase().includes(query) ||
      book.author.toLowerCase().includes(query) ||
      book.isbn.toLowerCase().includes(query);
    const matchesCategory = category === "All" || book.category === category;

    let matchesStatus = true;
    if (status === "Overdue") {
      matchesStatus = isBookOverdue(book);
    } else if (status !== "All") {
      matchesStatus = book.status === status;
    }

    return matchesSearch && matchesCategory && matchesStatus;
  });

  updateStats();

  if (filtered.length === 0) {
    bookList.innerHTML = `<p class="empty-msg">No books found matching your filters.</p>`;
    return;
  }

  const isAdmin = currentUser && currentUser.role === "admin";

  bookList.innerHTML = filtered
    .map((book) => {
      const isAvailable = book.status === "Available";
      const overdue = isBookOverdue(book);
      const badgeClass = isAvailable
        ? "badge-available"
        : overdue
        ? "badge-overdue"
        : "badge-borrowed";
      const badgeLabel = overdue ? "Overdue" : book.status;
      const actionBtnClass = isAvailable ? "btn-borrow" : "btn-return";
      const actionLabel = isAvailable ? "Borrow" : "Return";
      const hasPdf = book.pdfType && book.pdfType !== "none";

      return `
        <div class="book-item ${overdue ? "is-overdue" : ""}">
          <div>
            <div class="book-header">
              <div class="book-title">${escapeHtml(book.title)}</div>
              <span class="badge ${badgeClass}">${escapeHtml(badgeLabel)}</span>
            </div>
            <div class="book-meta">
              <p><strong>Author:</strong> ${escapeHtml(book.author)}</p>
              <p><strong>Category:</strong> ${escapeHtml(book.category)}</p>
              <p><strong>ISBN:</strong> ${escapeHtml(book.isbn)}</p>
              <p><strong>E-Book PDF:</strong> ${hasPdf ? "Attached" : "Not attached"}</p>
              ${book.borrower ? `<p><strong>Borrowed by:</strong> ${escapeHtml(book.borrower)}</p>` : ""}
              ${getDueStatusHtml(book)}
            </div>
          </div>
          <div class="book-actions">
            ${
              hasPdf
                ? `<button class="btn btn-read" data-action="read" data-id="${book.id}">Read PDF</button>`
                : ""
            }
            <button class="btn ${actionBtnClass}" data-action="toggle" data-id="${book.id}">
              ${actionLabel}
            </button>
            ${
              isAdmin
                ? `<button class="btn btn-delete" data-action="delete" data-id="${book.id}">Delete</button>`
                : ""
            }
          </div>
        </div>
      `;
    })
    .join("");
}

function renderHistory() {
  if (!currentUser || currentUser.role !== "admin") return;

  const query = historySearch.value.trim().toLowerCase();
  const actionFilter = historyFilterAction.value;

  const totalCollected = historyLog.reduce((sum, entry) => sum + (Number(entry.fineCollected) || 0), 0);
  historyCountEl.textContent = historyLog.length;
  collectedFinesTotalEl.textContent = `₹${totalCollected}`;

  const filtered = historyLog.filter((entry) => {
    const matchesSearch =
      entry.bookTitle.toLowerCase().includes(query) ||
      entry.isbn.toLowerCase().includes(query) ||
      entry.borrower.toLowerCase().includes(query);
    const matchesAction = actionFilter === "All" || entry.action === actionFilter;
    return matchesSearch && matchesAction;
  });

  if (filtered.length === 0) {
    historyTableBody.innerHTML = `
      <tr>
        <td colspan="8" class="table-empty">No transaction records found.</td>
      </tr>
    `;
    return;
  }

  historyTableBody.innerHTML = filtered
    .map((entry) => {
      const badgeClass = entry.action === "Borrowed" ? "badge-borrowed" : "badge-returned";
      const fineDisplay =
        entry.fineCollected > 0
          ? `<span class="fine-collected-cell">₹${entry.fineCollected}</span>`
          : "₹0";

      return `
        <tr>
          <td>${escapeHtml(entry.timestamp)}</td>
          <td><span class="badge ${badgeClass}">${escapeHtml(entry.action)}</span></td>
          <td>${escapeHtml(entry.bookTitle)}</td>
          <td>${escapeHtml(entry.isbn)}</td>
          <td>${escapeHtml(entry.borrower)}</td>
          <td>${escapeHtml(entry.dueDate)}</td>
          <td>${fineDisplay}</td>
          <td>${escapeHtml(entry.processedBy)}</td>
        </tr>
      `;
    })
    .join("");
}

bookForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser || currentUser.role !== "admin") return;

  const title = document.getElementById("title").value.trim();
  const author = document.getElementById("author").value.trim();
  const category = document.getElementById("category").value;
  const isbn = document.getElementById("isbn").value.trim();
  const pdfUrlInput = document.getElementById("pdfUrl").value.trim();
  const pdfFileInput = document.getElementById("pdfFile");
  const selectedFile = pdfFileInput.files[0];

  if (!title || !author || !category || !isbn) return;

  const newBookId = Date.now();
  let pdfType = "none";
  let pdfUrl = "";

  if (selectedFile) {
    if (selectedFile.type !== "application/pdf") {
      alert("Please select a valid PDF file.");
      return;
    }
    await savePdfBlob(newBookId, selectedFile);
    pdfType = "file";
  } else if (pdfUrlInput) {
    if (!isValidHttpUrl(pdfUrlInput)) {
      alert("Please enter a valid PDF URL starting with http:// or https://");
      return;
    }
    pdfType = "url";
    pdfUrl = pdfUrlInput;
  }

  books.unshift({
    id: newBookId,
    title,
    author,
    category,
    isbn,
    status: "Available",
    borrower: "",
    borrowDate: "",
    dueDate: "",
    pdfType,
    pdfUrl
  });

  saveBooks();
  bookForm.reset();
  renderBooks();
});

function openBorrowModal(book) {
  borrowBookId.value = book.id;
  borrowModalTitle.textContent = book.title;
  borrowerNameInput.value = currentUser.role === "student" ? currentUser.name : "";
  borrowDueDateInput.value = addDays(getTodayStr(), 7);
  borrowModal.classList.remove("hidden");
  borrowerNameInput.focus();
}

function closeBorrowModal() {
  borrowModal.classList.add("hidden");
  borrowForm.reset();
}

borrowForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = Number(borrowBookId.value);
  const borrower = borrowerNameInput.value.trim();
  const dueDate = borrowDueDateInput.value;

  if (!borrower || !dueDate) return;

  const book = books.find((b) => b.id === id);
  if (!book) return;

  book.status = "Borrowed";
  book.borrower = borrower;
  book.borrowDate = getTodayStr();
  book.dueDate = dueDate;

  saveBooks();
  addHistoryEntry({
    action: "Borrowed",
    bookTitle: book.title,
    isbn: book.isbn,
    borrower,
    dueDate,
    fineCollected: 0
  });

  closeBorrowModal();
  renderBooks();
});

closeBorrowModalBtn.addEventListener("click", closeBorrowModal);
cancelBorrowBtn.addEventListener("click", closeBorrowModal);
borrowModal.addEventListener("click", (e) => {
  if (e.target === borrowModal) closeBorrowModal();
});

bookList.addEventListener("click", async (e) => {
  const button = e.target.closest("button");
  if (!button) return;

  const id = Number(button.dataset.id);
  const action = button.dataset.action;
  const book = books.find((b) => b.id === id);
  if (!book) return;

  if (action === "read") {
    await openReaderModal(book);
  }

  if (action === "toggle") {
    if (book.status === "Available") {
      openBorrowModal(book);
    } else {
      const overdueDays = getOverdueDays(book);
      const fee = overdueDays > 0 ? getLateFee(book) : 0;

      if (overdueDays > 0) {
        const dayWord = overdueDays === 1 ? "day" : "days";
        const confirmed = confirm(
          `Return "${book.title}"?\n\nOverdue by ${overdueDays} ${dayWord}.\nLate fee to collect: ₹${fee}`
        );
        if (!confirmed) return;
      }

      const previousBorrower = book.borrower || "Unknown";
      const previousDueDate = book.dueDate || "-";

      book.status = "Available";
      book.borrower = "";
      book.borrowDate = "";
      book.dueDate = "";
      saveBooks();

      addHistoryEntry({
        action: "Returned",
        bookTitle: book.title,
        isbn: book.isbn,
        borrower: previousBorrower,
        dueDate: previousDueDate,
        fineCollected: fee
      });

      renderBooks();
    }
  }

  if (action === "delete") {
    if (!currentUser || currentUser.role !== "admin") return;
    if (!confirm("Delete this book from the library?")) return;

    if (book.pdfType === "file") {
      await deletePdfBlob(book.id);
    }
    books = books.filter((b) => b.id !== id);
    saveBooks();
    renderBooks();
  }
});

async function openReaderModal(book) {
  let sourceUrl = "";

  if (book.pdfType === "file") {
    const blob = await getPdfBlob(book.id);
    if (!blob) {
      alert("This local PDF is no longer available in browser storage. Please re-upload it.");
      return;
    }
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
    }
    activeObjectUrl = URL.createObjectURL(blob);
    sourceUrl = activeObjectUrl;
  } else if (book.pdfType === "url" && isValidHttpUrl(book.pdfUrl)) {
    sourceUrl = book.pdfUrl;
  } else {
    alert("No PDF is attached to this book.");
    return;
  }

  pdfModalTitle.textContent = book.title;
  pdfFrame.src = sourceUrl;
  pdfOpenNewTab.href = sourceUrl;
  pdfModal.classList.remove("hidden");
}

function closeReaderModal() {
  pdfModal.classList.add("hidden");
  pdfFrame.src = "about:blank";
  pdfOpenNewTab.href = "#";
  if (activeObjectUrl) {
    URL.revokeObjectURL(activeObjectUrl);
    activeObjectUrl = null;
  }
}

closePdfModal.addEventListener("click", closeReaderModal);
pdfModal.addEventListener("click", (e) => {
  if (e.target === pdfModal) closeReaderModal();
});

viewOverdueBtn.addEventListener("click", () => {
  filterStatus.value = "Overdue";
  filterCategory.value = "All";
  searchInput.value = "";
  renderBooks();
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeReaderModal();
    closeBorrowModal();
  }
});

searchInput.addEventListener("input", renderBooks);
filterCategory.addEventListener("change", renderBooks);
filterStatus.addEventListener("change", renderBooks);
historySearch.addEventListener("input", renderHistory);
historyFilterAction.addEventListener("change", renderHistory);

(function init() {
  try {
    const savedSession = sessionStorage.getItem(SESSION_KEY);
    if (savedSession) {
      showAppForUser(JSON.parse(savedSession));
      return;
    }
  } catch (err) {
    // Ignore invalid session
  }
  showLogin();
})();