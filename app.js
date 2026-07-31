import { getAllNotes, removeNote, saveNote, seedNotesIfEmpty } from "./db.js";
import {
  deleteCloudNote,
  createNoteInvite,
  getSession,
  mergeNotes,
  redeemNoteInvite,
  saveCloudNote,
  signIn,
  signOut,
  signUp,
  subscribeToNote,
} from "./cloud.js";

const elements = {
  accountButton: document.querySelector("#account-button"),
  archiveButton: document.querySelector("#archive-button"),
  archiveCount: document.querySelector("#archive-count"),
  authClose: document.querySelector("#auth-close"),
  authDescription: document.querySelector("#auth-description"),
  authDialog: document.querySelector("#auth-dialog"),
  authEmail: document.querySelector("#auth-email"),
  authForm: document.querySelector("#auth-form"),
  authMessage: document.querySelector("#auth-message"),
  authPassword: document.querySelector("#auth-password"),
  authSubmit: document.querySelector("#auth-submit"),
  authSwitch: document.querySelector("#auth-switch"),
  authTitle: document.querySelector("#auth-title"),
  closeSidebar: document.querySelector("#close-sidebar"),
  cloudDetail: document.querySelector("#cloud-detail"),
  cloudStatus: document.querySelector("#cloud-status"),
  contentInput: document.querySelector("#content-input"),
  deleteButton: document.querySelector("#delete-button"),
  deleteDialog: document.querySelector("#delete-dialog"),
  editor: document.querySelector("#editor"),
  editorPanel: document.querySelector("#editor-panel"),
  editorEmpty: document.querySelector("#editor-empty"),
  editorNewNote: document.querySelector("#editor-new-note"),
  emptyList: document.querySelector("#empty-list"),
  emptyNewNote: document.querySelector("#empty-new-note"),
  exportButton: document.querySelector("#export-button"),
  favoriteButton: document.querySelector("#favorite-button"),
  favoritesCount: document.querySelector("#favorites-count"),
  mobileNewNote: document.querySelector("#mobile-new-note"),
  newNoteButton: document.querySelector("#new-note-button"),
  noteList: document.querySelector("#note-list"),
  notesCount: document.querySelector("#notes-count"),
  openSidebar: document.querySelector("#open-sidebar"),
  resultsLabel: document.querySelector("#results-label"),
  saveState: document.querySelector("#save-state"),
  shareButton: document.querySelector("#share-button"),
  shareClose: document.querySelector("#share-close"),
  shareDialog: document.querySelector("#share-dialog"),
  shareForm: document.querySelector("#share-form"),
  shareMessage: document.querySelector("#share-message"),
  shareResult: document.querySelector("#share-result"),
  shareSubmit: document.querySelector("#share-submit"),
  shareUrl: document.querySelector("#share-url"),
  copyShareLink: document.querySelector("#copy-share-link"),
  accessBanner: document.querySelector("#access-banner"),
  searchInput: document.querySelector("#search-input"),
  sidebar: document.querySelector("#sidebar"),
  sidebarScrim: document.querySelector("#sidebar-scrim"),
  sortSelect: document.querySelector("#sort-select"),
  tagForm: document.querySelector("#tag-form"),
  tagInput: document.querySelector("#tag-input"),
  tagList: document.querySelector("#tag-list"),
  titleInput: document.querySelector("#title-input"),
  toast: document.querySelector("#toast"),
  updatedLabel: document.querySelector("#updated-label"),
  viewTitle: document.querySelector("#view-title"),
  wordCount: document.querySelector("#word-count"),
};

const state = {
  notes: [],
  selectedId: null,
  view: "notes",
  query: "",
  sort: "updated-desc",
  saveTimer: null,
  session: null,
  authMode: "signin",
  syncing: false,
  stopRealtime: null,
  pendingInvite: new URLSearchParams(window.location.search).get("invite"),
};

function currentNote() {
  return state.notes.find((note) => note.id === state.selectedId) ?? null;
}

function canEditNote(note) {
  return note && (note.accessRole == null || note.accessRole === "owner" || note.accessRole === "editor");
}

function createBlankNote() {
  const timestamp = Date.now();
  return {
    id: crypto.randomUUID(),
    title: "",
    content: "",
    tags: [],
    favorite: false,
    archived: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function createNote() {
  const note = createBlankNote();
  if (state.session) {
    note.ownerId = state.session.user.id;
    note.accessRole = "owner";
  }
  state.notes.unshift(note);
  state.selectedId = note.id;
  state.view = "notes";
  await saveNote(note);
  if (state.session) {
    try {
      await saveCloudNote(note, state.session.user.id);
    } catch (error) {
      handleCloudError(error);
    }
  }
  render();
  elements.titleInput.focus();
  closeSidebar();
}

function filteredNotes() {
  const query = state.query.trim().toLowerCase();
  let result = state.notes.filter((note) => {
    if (state.view === "archive") return note.archived;
    if (note.archived) return false;
    if (state.view === "favorites" && !note.favorite) return false;
    return true;
  });

  if (query) {
    result = result.filter((note) =>
      [note.title, note.content, ...note.tags].some((value) =>
        value.toLowerCase().includes(query),
      ),
    );
  }

  return result.sort((a, b) => {
    if (state.sort === "title-asc") {
      return displayTitle(a).localeCompare(displayTitle(b));
    }
    if (state.sort === "created-desc") return b.createdAt - a.createdAt;
    return b.updatedAt - a.updatedAt;
  });
}

function displayTitle(note) {
  return note.title.trim() || "Untitled note";
}

function previewText(note) {
  const clean = note.content.replace(/\s+/g, " ").trim();
  return clean || "Empty note";
}

function relativeTime(timestamp) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}

function render() {
  renderNavigation();
  renderNoteList();
  renderEditor();
}

function renderNavigation() {
  const active = state.notes.filter((note) => !note.archived);
  elements.notesCount.textContent = active.length;
  elements.favoritesCount.textContent = active.filter((note) => note.favorite).length;
  elements.archiveCount.textContent = state.notes.filter((note) => note.archived).length;

  const titles = {
    notes: "All notes",
    favorites: "Favorites",
    archive: "Archive",
  };
  elements.viewTitle.textContent = titles[state.view];

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
}

function renderNoteList() {
  const notes = filteredNotes();
  elements.noteList.replaceChildren();
  elements.emptyList.hidden = notes.length !== 0;
  elements.noteList.hidden = notes.length === 0;
  elements.resultsLabel.textContent = state.query
    ? `${notes.length} matching ${notes.length === 1 ? "note" : "notes"}`
    : state.view === "archive"
      ? "Notes kept out of the way"
      : "Your recent thinking";

  notes.forEach((note) => {
    const button = document.createElement("button");
    const heading = document.createElement("span");
    const preview = document.createElement("span");
    const footer = document.createElement("span");
    const tags = document.createElement("span");
    const time = document.createElement("span");

    button.type = "button";
    button.className = "note-card";
    button.classList.toggle("is-selected", note.id === state.selectedId);
    button.addEventListener("click", () => selectNote(note.id));

    heading.className = "note-card-title";
    heading.textContent = displayTitle(note);
    if (note.favorite) {
      const star = document.createElement("span");
      star.className = "favorite-star";
      star.textContent = "★";
      heading.append(star);
    }

    preview.className = "note-card-preview";
    preview.textContent = previewText(note);

    footer.className = "note-card-footer";
    tags.className = "mini-tags";
    note.tags.slice(0, 2).forEach((tag) => {
      const chip = document.createElement("span");
      chip.textContent = tag;
      tags.append(chip);
    });
    time.textContent = relativeTime(note.updatedAt);

    footer.append(tags, time);
    button.append(heading, preview, footer);
    elements.noteList.append(button);
  });
}

function renderEditor() {
  const note = currentNote();
  elements.editor.hidden = !note;
  elements.editorEmpty.hidden = Boolean(note);
  if (!note) return;

  const accessRole = note.accessRole ?? "owner";
  const canEdit = accessRole === "owner" || accessRole === "editor";
  const isOwner = accessRole === "owner";

  if (elements.titleInput !== document.activeElement) elements.titleInput.value = note.title;
  if (elements.contentInput !== document.activeElement) elements.contentInput.value = note.content;
  elements.favoriteButton.textContent = note.favorite ? "★" : "☆";
  elements.favoriteButton.classList.toggle("is-favorite", note.favorite);
  elements.favoriteButton.setAttribute("aria-label", note.favorite ? "Remove favorite" : "Favorite note");
  elements.archiveButton.textContent = note.archived ? "↩" : "⌑";
  elements.archiveButton.setAttribute("aria-label", note.archived ? "Restore note" : "Archive note");
  elements.titleInput.readOnly = !canEdit;
  elements.contentInput.readOnly = !canEdit;
  elements.tagInput.disabled = !canEdit;
  elements.favoriteButton.disabled = !canEdit;
  elements.archiveButton.disabled = !canEdit;
  elements.deleteButton.disabled = !isOwner;
  elements.shareButton.disabled = !isOwner || !state.session;
  elements.accessBanner.hidden = isOwner;
  elements.accessBanner.textContent =
    accessRole === "viewer"
      ? "Shared with you as a viewer. You can read this note but cannot change it."
      : "Shared with you as an editor. Your changes sync with everyone who has access.";
  elements.updatedLabel.textContent = `Edited ${relativeTime(note.updatedAt)}`;
  renderWordCount(note.content);
  renderTags(note);
}

function renderTags(note) {
  elements.tagList.replaceChildren();
  note.tags.forEach((tag) => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-chip";
    chip.textContent = `${tag} ×`;
    chip.setAttribute("aria-label", `Remove ${tag} tag`);
    chip.disabled = !canEditNote(note);
    chip.addEventListener("click", () => removeTag(tag));
    elements.tagList.append(chip);
  });
}

function renderWordCount(content) {
  const count = content.trim() ? content.trim().split(/\s+/).length : 0;
  elements.wordCount.textContent = `${count} ${count === 1 ? "word" : "words"}`;
}

function selectNote(id) {
  state.selectedId = id;
  render();
  subscribeToSelectedNote();
  if (window.innerWidth < 800) {
    elements.editorPanel?.classList.add("is-open");
  }
}

function updateCurrentNote(patch) {
  const note = currentNote();
  if (!canEditNote(note)) return;
  Object.assign(note, patch, { updatedAt: Date.now() });
  elements.saveState.textContent = "Saving…";
  window.clearTimeout(state.saveTimer);
  state.saveTimer = window.setTimeout(async () => {
    await saveNote(note);
    if (state.session) {
      try {
        const saved = await saveCloudNote(note, state.session.user.id);
        note.updatedAt = saved.updatedAt;
        setCloudStatus("online", "Synced", state.session.user.email);
      } catch (error) {
        handleCloudError(error);
      }
    }
    elements.saveState.textContent = "Saved";
    renderNoteList();
    elements.updatedLabel.textContent = "Edited just now";
  }, 350);
}

async function toggleFavorite() {
  const note = currentNote();
  if (!canEditNote(note)) return;
  updateCurrentNote({ favorite: !note.favorite });
  renderNavigation();
  renderEditor();
}

async function toggleArchive() {
  const note = currentNote();
  if (!canEditNote(note)) return;
  note.archived = !note.archived;
  note.updatedAt = Date.now();
  await saveNote(note);
  if (state.session) {
    try {
      await saveCloudNote(note, state.session.user.id);
    } catch (error) {
      handleCloudError(error);
    }
  }
  showToast(note.archived ? "Note archived" : "Note restored");
  state.selectedId = filteredNotes().find((item) => item.id !== note.id)?.id ?? null;
  render();
}

async function confirmDelete() {
  const note = currentNote();
  if (!note || (note.accessRole && note.accessRole !== "owner")) return;
  elements.deleteDialog.showModal();
  const onClose = async () => {
    elements.deleteDialog.removeEventListener("close", onClose);
    if (elements.deleteDialog.returnValue !== "confirm") return;
    await removeNote(note.id);
    if (state.session) {
      try {
        await deleteCloudNote(note.id);
      } catch (error) {
        handleCloudError(error);
      }
    }
    state.notes = state.notes.filter((item) => item.id !== note.id);
    state.selectedId = filteredNotes()[0]?.id ?? null;
    render();
    showToast("Note deleted");
  };
  elements.deleteDialog.addEventListener("close", onClose);
}

function addTag(value) {
  const note = currentNote();
  const tag = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (!canEditNote(note) || !tag || note.tags.includes(tag)) return;
  if (note.tags.length >= 6) {
    showToast("Six tags per note is enough");
    return;
  }
  note.tags.push(tag);
  elements.tagInput.value = "";
  updateCurrentNote({ tags: note.tags });
  renderTags(note);
}

function removeTag(tag) {
  const note = currentNote();
  if (!canEditNote(note)) return;
  note.tags = note.tags.filter((item) => item !== tag);
  updateCurrentNote({ tags: note.tags });
  renderTags(note);
}

function exportNotes() {
  const payload = {
    app: "Draftroom",
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: state.notes,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `draftroom-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("Backup exported");
}

function showToast(text) {
  elements.toast.textContent = text;
  elements.toast.classList.add("is-visible");
  window.setTimeout(() => elements.toast.classList.remove("is-visible"), 2200);
}

function setCloudStatus(kind, status, detail) {
  const card = elements.cloudStatus.closest(".sync-card");
  card.classList.toggle("is-online", kind === "online");
  card.classList.toggle("is-error", kind === "error");
  elements.cloudStatus.textContent = status;
  elements.cloudDetail.textContent = detail;
  elements.accountButton.textContent = state.session ? "Sign out" : "Sign in to sync";
}

async function subscribeToSelectedNote() {
  if (state.stopRealtime) {
    await state.stopRealtime();
    state.stopRealtime = null;
  }
  const note = currentNote();
  if (!state.session || !note) return;

  state.stopRealtime = await subscribeToNote(note.id, async (remoteNote) => {
    const local = state.notes.find((item) => item.id === remoteNote.id);
    remoteNote.accessRole = local?.accessRole ?? remoteNote.accessRole;
    remoteNote.ownerId = local?.ownerId ?? remoteNote.ownerId;
    const index = state.notes.findIndex((item) => item.id === remoteNote.id);
    if (index >= 0) state.notes[index] = remoteNote;
    await saveNote(remoteNote);
    render();
    setCloudStatus("online", "Updated together", state.session.user.email);
  });
}

function openShareDialog() {
  const note = currentNote();
  if (!state.session || !note || (note.accessRole && note.accessRole !== "owner")) return;
  elements.shareResult.hidden = true;
  elements.shareMessage.textContent = "";
  elements.shareSubmit.disabled = false;
  elements.shareDialog.showModal();
}

async function handleShareSubmit(event) {
  event.preventDefault();
  const note = currentNote();
  if (!note || !state.session || (note.accessRole && note.accessRole !== "owner")) return;
  const role = new FormData(elements.shareForm).get("share-role");
  elements.shareSubmit.disabled = true;
  elements.shareMessage.textContent = "";

  try {
    const invite = await createNoteInvite(note.id, role);
    const url = new URL("app.html", window.location.href);
    url.searchParams.set("invite", invite.token);
    elements.shareUrl.value = url.href;
    elements.shareResult.hidden = false;
    elements.shareSubmit.textContent = "Create another link";
  } catch (error) {
    elements.shareMessage.textContent = error?.message || "Could not create an invitation";
  } finally {
    elements.shareSubmit.disabled = false;
  }
}

async function copyShareLink() {
  await navigator.clipboard.writeText(elements.shareUrl.value);
  showToast("Invitation link copied");
}

function handleCloudError(error) {
  console.error(error);
  setCloudStatus("error", "Saved locally", "Cloud sync will retry when you sign in again.");
  showToast(error?.message || "Cloud sync is unavailable");
}

function renderAuthMode() {
  const signingUp = state.authMode === "signup";
  elements.authTitle.textContent = signingUp ? "Create an account" : "Sign in";
  elements.authDescription.textContent = signingUp
    ? "Your notes stay private to this account."
    : "Sync your private notes across your devices.";
  elements.authSubmit.textContent = signingUp ? "Create account" : "Sign in";
  elements.authSwitch.textContent = signingUp
    ? "Already have an account? Sign in"
    : "New here? Create an account";
  elements.authPassword.autocomplete = signingUp ? "new-password" : "current-password";
  elements.authMessage.textContent = "";
}

function openAuthDialog() {
  state.authMode = "signin";
  renderAuthMode();
  elements.authDialog.showModal();
  elements.authEmail.focus();
}

async function handleAccountButton() {
  if (!state.session) {
    openAuthDialog();
    return;
  }

  elements.accountButton.disabled = true;
  try {
    await signOut();
    state.session = null;
    setCloudStatus("local", "Saved on this device", "Sign in to sync between devices.");
    showToast("Signed out. Local notes remain available.");
  } catch (error) {
    handleCloudError(error);
  } finally {
    elements.accountButton.disabled = false;
  }
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const email = elements.authEmail.value.trim();
  const password = elements.authPassword.value;
  elements.authSubmit.disabled = true;
  elements.authMessage.textContent = "";

  try {
    if (state.authMode === "signup") {
      const data = await signUp(email, password);
      if (!data.session) {
        elements.authMessage.style.color = "var(--olive)";
        elements.authMessage.textContent = "Check your email, confirm the account, then sign in.";
        return;
      }
      state.session = data.session;
    } else {
      state.session = await signIn(email, password);
    }

    elements.authDialog.close();
    await synchronizeCloud();
    await redeemPendingInvite();
  } catch (error) {
    elements.authMessage.style.color = "var(--rust)";
    elements.authMessage.textContent = error?.message || "Authentication failed";
  } finally {
    elements.authSubmit.disabled = false;
  }
}

async function synchronizeCloud() {
  if (!state.session || state.syncing) return;
  state.syncing = true;
  setCloudStatus("online", "Syncing…", state.session.user.email);

  try {
    const merged = await mergeNotes(state.notes, state.session.user.id);
    await Promise.all(merged.map(saveNote));
    state.notes = merged;
    if (!state.notes.some((note) => note.id === state.selectedId)) {
      state.selectedId = filteredNotes()[0]?.id ?? null;
    }
    render();
    await subscribeToSelectedNote();
    setCloudStatus("online", "Synced", state.session.user.email);
    showToast("Notes synced securely");
  } catch (error) {
    handleCloudError(error);
  } finally {
    state.syncing = false;
  }
}

async function redeemPendingInvite() {
  if (!state.pendingInvite || !state.session) return;
  setCloudStatus("online", "Joining note…", state.session.user.email);
  try {
    const noteId = await redeemNoteInvite(state.pendingInvite);
    state.pendingInvite = null;
    window.history.replaceState({}, "", "app.html");
    const merged = await mergeNotes(state.notes, state.session.user.id);
    await Promise.all(merged.map(saveNote));
    state.notes = merged;
    state.selectedId = noteId;
    state.view = "notes";
    render();
    await subscribeToSelectedNote();
    showToast("Shared note added to your workspace");
  } catch (error) {
    handleCloudError(error);
  }
}

async function initializeCloud() {
  setCloudStatus("local", "Saved on this device", "Connecting to Draftroom Cloud…");
  try {
    state.session = await getSession();
    if (state.session) {
      await synchronizeCloud();
      await redeemPendingInvite();
    } else {
      setCloudStatus("local", "Saved on this device", "Sign in to sync between devices.");
      if (state.pendingInvite) {
        openAuthDialog();
        elements.authMessage.style.color = "var(--olive)";
        elements.authMessage.textContent = "Sign in or create an account to open this shared note.";
      }
    }
  } catch (error) {
    handleCloudError(error);
  }
}

function openSidebar() {
  elements.sidebar.classList.add("is-open");
  elements.sidebarScrim.classList.add("is-visible");
}

function closeSidebar() {
  elements.sidebar.classList.remove("is-open");
  elements.sidebarScrim.classList.remove("is-visible");
}

function bindEvents() {
  [elements.newNoteButton, elements.mobileNewNote, elements.emptyNewNote, elements.editorNewNote].forEach(
    (button) => button.addEventListener("click", createNote),
  );

  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      const visible = filteredNotes();
      if (!visible.some((note) => note.id === state.selectedId)) {
        state.selectedId = visible[0]?.id ?? null;
      }
      render();
      closeSidebar();
    });
  });

  elements.searchInput.addEventListener("input", () => {
    state.query = elements.searchInput.value;
    renderNoteList();
  });
  elements.sortSelect.addEventListener("change", () => {
    state.sort = elements.sortSelect.value;
    renderNoteList();
  });
  elements.titleInput.addEventListener("input", () => {
    updateCurrentNote({ title: elements.titleInput.value });
  });
  elements.contentInput.addEventListener("input", () => {
    updateCurrentNote({ content: elements.contentInput.value });
    renderWordCount(elements.contentInput.value);
  });
  elements.tagForm.addEventListener("submit", (event) => {
    event.preventDefault();
    addTag(elements.tagInput.value);
  });
  elements.favoriteButton.addEventListener("click", toggleFavorite);
  elements.archiveButton.addEventListener("click", toggleArchive);
  elements.deleteButton.addEventListener("click", confirmDelete);
  elements.exportButton.addEventListener("click", exportNotes);
  elements.shareButton.addEventListener("click", openShareDialog);
  elements.shareClose.addEventListener("click", () => elements.shareDialog.close());
  elements.shareForm.addEventListener("submit", handleShareSubmit);
  elements.copyShareLink.addEventListener("click", copyShareLink);
  elements.accountButton.addEventListener("click", handleAccountButton);
  elements.authClose.addEventListener("click", () => elements.authDialog.close());
  elements.authSwitch.addEventListener("click", () => {
    state.authMode = state.authMode === "signin" ? "signup" : "signin";
    renderAuthMode();
  });
  elements.authForm.addEventListener("submit", handleAuthSubmit);
  elements.openSidebar.addEventListener("click", openSidebar);
  elements.closeSidebar.addEventListener("click", closeSidebar);
  elements.sidebarScrim.addEventListener("click", closeSidebar);

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      elements.searchInput.focus();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
      event.preventDefault();
      createNote();
    }
  });
}

async function initialize() {
  state.notes = await seedNotesIfEmpty();
  state.selectedId = filteredNotes()[0]?.id ?? null;
  bindEvents();
  render();
  initializeCloud();
}

initialize().catch((error) => {
  console.error(error);
  showToast("Could not open the local notebook");
});
