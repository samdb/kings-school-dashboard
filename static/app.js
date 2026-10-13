/* The Family School Desk — client. All email-derived text is set with textContent only. */
(function () {
  "use strict";

  var DEFAULT_QUERY = "from:(kings-rochester.co.uk) newer_than:180d";
  var state = {
    feed: null,
    view: "child",
    search: "",
    actionsOnly: false,
    savedOnly: false,
    includeHidden: false,
    activity: null,
    expanded: {},
    history: {},
    pollTimer: null,
    loadError: null,
  };

  var $ = function (id) { return document.getElementById(id); };

  function el(tag, opts, children) {
    var node = document.createElement(tag);
    opts = opts || {};
    if (opts.cls) node.className = opts.cls;
    if (opts.text != null) node.textContent = String(opts.text);
    if (opts.attrs) Object.keys(opts.attrs).forEach(function (k) { node.setAttribute(k, opts.attrs[k]); });
    (children || []).forEach(function (c) { if (c) node.appendChild(c); });
    return node;
  }

  // ---------- API ----------
  function api(path, body) {
    var init = { method: body === undefined ? "GET" : "POST", credentials: "same-origin",
                 headers: { "Accept": "application/json" }, cache: "no-store" };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    return fetch(path, init).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok && res.status !== 409) {
          var err = new Error(data.error || ("Request failed (" + res.status + ")"));
          err.status = res.status;
          throw err;
        }
        data._status = res.status;
        return data;
      });
    });
  }

  // ---------- dates ----------
  var fmtFull = new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  function formatDate(iso) {
    if (!iso) return "unknown date";
    var d = new Date(iso);
    return isNaN(d) ? "unknown date" : fmtFull.format(d);
  }
  function relative(iso) {
    var d = new Date(iso);
    if (!iso || isNaN(d)) return "never";
    var mins = Math.round((Date.now() - d.getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return mins + " min ago";
    var hrs = Math.round(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? " hour ago" : " hours ago");
    var days = Math.round(hrs / 24);
    return days + (days === 1 ? " day ago" : " days ago");
  }

  // ---------- data loading ----------
  function load() {
    return api("/api/feed").then(function (feed) {
      state.feed = feed;
      state.loadError = null;
      render();
      schedulePoll();
    }).catch(function (err) {
      state.loadError = err.message || "Could not reach the dashboard server.";
      render();
      schedulePoll(15000);
    });
  }

  function schedulePoll(ms) {
    clearTimeout(state.pollTimer);
    var running = state.feed && state.feed.refresh && state.feed.refresh.running;
    state.pollTimer = setTimeout(load, ms || (running ? 2000 : 60000));
  }

  function refresh() {
    setRefreshing(true);
    api("/api/refresh", {}).then(function () {
      setTimeout(load, 600);
    }).catch(function (err) {
      setRefreshing(false);
      showTransientAlert("Refresh could not start: " + err.message);
    });
  }

  // ---------- header ----------
  var CONNECTION = {
    connected: ["pill--ok", "Gmail connected"],
    partial: ["pill--warn", "Some accounts need attention"],
    error: ["pill--bad", "Gmail sync failing"],
    never_synced: ["pill--muted", "Not synced yet"],
    not_configured: ["pill--muted", "Gmail not set up"],
    demo: ["pill--demo", "Demo mode"],
  };

  function setRefreshing(on) {
    var btn = $("refresh-btn");
    btn.disabled = on;
    btn.classList.toggle("is-spinning", on);
    $("refresh-label").textContent = on ? "Refreshing…" : "Refresh";
  }

  function renderHeader(feed) {
    var conn = CONNECTION[feed.connection] || CONNECTION.never_synced;
    var pill = $("connection");
    pill.className = "pill " + conn[0];
    pill.textContent = conn[1];
    $("last-refresh").textContent = feed.mode === "demo"
      ? "Showing synthetic sample content"
      : feed.last_successful_refresh
        ? "Last successful refresh: " + formatDate(feed.last_successful_refresh) + " (" + relative(feed.last_successful_refresh) + ")"
        : "Last successful refresh: never";
    $("last-refresh").title = "Auto-refresh every " + feed.refresh_minutes + " minutes while the server runs";
    var running = feed.refresh && feed.refresh.running;
    setRefreshing(!!running);
    $("refresh-btn").disabled = !!running || feed.mode === "demo" || feed.connection === "not_configured";
    $("demo-banner").hidden = feed.mode !== "demo";

    var name = feed.profile.child_first_name;
    $("tab-child-label").textContent = name ? "For " + name : "For your child";
    $("tab-year-label").textContent = "Year " + feed.profile.year_group;
  }

  function renderAlerts(feed) {
    var box = $("alerts");
    box.textContent = "";
    if (state.loadError) {
      box.appendChild(el("div", { cls: "alert", attrs: { role: "alert" } }, [
        el("strong", { text: "Can't reach the dashboard server." }),
        el("p", { text: state.loadError + " Showing what was last loaded; retrying automatically." }),
      ]));
    }
    if (!feed || feed.mode === "demo") return;
    feed.accounts.forEach(function (a) {
      if (a.error) {
        var auth = a.error.kind === "auth";
        box.appendChild(el("div", { cls: "alert" + (auth ? "" : " alert--warn"), attrs: { role: "alert" } }, [
          el("strong", { text: (auth ? "Gmail access expired for " : "Couldn't refresh ") + a.account }),
          el("p", { text: a.error.message }),
          el("p", { text: a.last_success
            ? "Still showing emails from the last good sync (" + formatDate(a.last_success) + ")."
            : "No emails have been loaded for this account yet." }),
        ]));
      } else if (a.stale_query) {
        box.appendChild(el("div", { cls: "alert alert--warn" }, [
          el("strong", { text: "Search query changed" }),
          el("p", { text: "Emails for " + a.account + " are from the previous query until the next refresh." }),
        ]));
      }
    });
  }

  function showTransientAlert(msg) {
    var node = el("div", { cls: "alert alert--warn", attrs: { role: "alert" } }, [el("p", { text: msg })]);
    $("alerts").appendChild(node);
    setTimeout(function () { node.remove(); }, 8000);
  }

  function renderCoverage(feed) {
    var box = $("coverage");
    box.textContent = "";
    if (feed.mode === "demo") {
      box.appendChild(el("p", { cls: "coverage__acct", text: "Demo mode: no Gmail data is shown." }));
      return;
    }
    if (!feed.accounts.length) {
      box.appendChild(el("p", { cls: "coverage__acct", text: "No Gmail accounts configured." }));
      return;
    }
    feed.accounts.forEach(function (a) {
      var c = a.coverage || {};
      var lines = [];
      if (a.last_success) {
        lines.push(a.item_count + " threads loaded · synced " + relative(a.last_success));
        if (c.more_available) lines.push("Older matching threads not loaded (page cap reached).");
        if (c.budget_hit) lines.push("Refresh time limit reached; some threads not updated.");
        if (c.failed) lines.push(c.failed + " thread(s) could not be read this time.");
      } else {
        lines.push(a.error ? "Not synced — see message above." : "Waiting for first sync.");
      }
      box.appendChild(el("p", { cls: "coverage__acct" }, [
        el("strong", { text: a.account }),
        el("span", { text: lines.join(" ") }),
      ]));
    });
  }

  // ---------- filtering ----------
  function inView(item, view) {
    var m = item.match;
    if (view === "child") return m.direct || m.year_match || m.activities.length > 0;
    if (view === "year") return m.year_match;
    return true;
  }

  function passesFilters(item) {
    var mk = item.mark;
    if (!state.includeHidden && (mk.done || mk.dismissed)) return false;
    if (state.savedOnly && !mk.saved) return false;
    if (state.actionsOnly && !item.match.possible_actions.length) return false;
    if (state.activity && item.match.activities.indexOf(state.activity) === -1) return false;
    if (state.search) {
      var hay = [item.subject, item.from_name, item.from_address, item.new_text, item.excerpt].join(" ").toLowerCase();
      var terms = state.search.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < terms.length; i++) if (hay.indexOf(terms[i]) === -1) return false;
    }
    return true;
  }

  function sectionsFor(view, profile) {
    var name = profile.child_first_name || "your child";
    var y = "Year " + profile.year_group;
    var all = {
      direct: { title: "Mentions " + name + " by name", note: "Name appears in the email itself (quoted replies ignored)." },
      year: { title: y, note: "Addressed to " + y + ", including lists and ranges such as “Years 1–6”." },
      activity: { title: "Activities you follow", note: "Possible relevance only — a mention is not proof of enrolment." },
      general: { title: "General school correspondence", note: "No year group matched." },
      other: { title: "Other year groups", note: "Mentions only year groups other than " + y + "." },
    };
    var order = view === "child" ? ["direct", "year", "activity"]
      : view === "year" ? ["year"]
      : ["direct", "year", "activity", "general", "other"];
    return order.map(function (k) { return { key: k, title: all[k].title, note: all[k].note }; });
  }

  // ---------- rendering ----------
  function render() {
    var feed = state.feed;
    var main = $("feed");
    renderAlerts(feed);
    if (!feed) {
      if (state.loadError) {
        main.textContent = "";
        main.appendChild(emptyState("Can't load the desk", [state.loadError], null));
        main.setAttribute("aria-busy", "false");
      }
      return;
    }
    renderHeader(feed);
    renderCoverage(feed);
    renderActivityChips(feed.profile);

    var items = feed.items;
    ["child", "year", "all"].forEach(function (v) {
      var n = items.filter(function (it) { return inView(it, v) && passesFilters(it); }).length;
      $("count-" + v).textContent = n ? String(n) : "";
    });

    main.textContent = "";
    main.setAttribute("aria-busy", "false");

    if (feed.mode !== "demo" && feed.connection === "not_configured") {
      main.appendChild(emptyState("Connect your school email",
        ["Nothing is shown until real school emails are synced — no activity is ever invented.",
         "Open Settings to add the Gmail account(s) that receive King's School emails, your child's first name and year group.",
         "Want to look around first? Turn on demo mode for clearly-labelled sample content."],
        { label: "Open settings", onClick: openSettings }));
      return;
    }
    if (!items.length) {
      var running = feed.refresh && feed.refresh.running;
      if (running) {
        main.appendChild(loadingState("Fetching school emails from Gmail (read-only)…"));
      } else if (feed.connection === "never_synced") {
        main.appendChild(emptyState("Not synced yet", ["Press Refresh to read school emails from Gmail."],
          { label: "Refresh now", onClick: refresh }));
      } else if (feed.connection === "error") {
        main.appendChild(emptyState("No emails loaded", ["Gmail sync failed — see the message above."], null));
      } else {
        main.appendChild(emptyState("No school emails found",
          ["The search “" + (feed.query || "") + "” returned nothing in the synced accounts.",
           "Check the query in Settings if you expected emails here."], null));
      }
      return;
    }

    var sections = sectionsFor(state.view, feed.profile);
    var shown = 0;
    sections.forEach(function (sec) {
      var rows = items.filter(function (it) {
        return it.match.category === sec.key && inView(it, state.view) && passesFilters(it);
      });
      if (state.view === "year" && sec.key === "year") {
        rows = items.filter(function (it) { return inView(it, "year") && passesFilters(it); });
      }
      if (!rows.length) return;
      shown += rows.length;
      var head = el("div", { cls: "section__head" }, [
        el("h2", { cls: "section__title", text: sec.title }),
        el("p", { cls: "section__note", text: sec.note }),
      ]);
      var section = el("section", { cls: "section", attrs: { "aria-label": sec.title } }, [head]);
      rows.forEach(function (it) { section.appendChild(card(it, feed.profile)); });
      main.appendChild(section);
    });

    if (!shown) {
      var who = feed.profile.child_first_name || "your child";
      var filtered = state.search || state.actionsOnly || state.savedOnly || state.activity;
      var msg = filtered ? ["No emails match these filters."]
        : state.view === "child" ? ["Nothing names " + who + ", mentions Year " + feed.profile.year_group +
            " or an activity you follow in the synced emails.", "Check “All school” for general updates."]
        : state.view === "year" ? ["No synced emails mention Year " + feed.profile.year_group + "."]
        : ["Everything here is done or dismissed."];
      main.appendChild(emptyState(filtered ? "Nothing matches" : "All clear", msg,
        filtered ? { label: "Clear filters", onClick: clearFilters } : null));
    }
  }

  function emptyState(title, lines, action) {
    var box = el("div", { cls: "state" }, [el("h2", { text: title })]);
    lines.forEach(function (l) { box.appendChild(el("p", { text: l })); });
    if (action) {
      var b = el("button", { cls: "btn btn--primary", text: action.label, attrs: { type: "button" } });
      b.addEventListener("click", action.onClick);
      box.appendChild(b);
    }
    return box;
  }

  function loadingState(text) {
    return el("div", { cls: "state state--loading" }, [
      el("div", { cls: "skeleton" }), el("div", { cls: "skeleton" }), el("p", { text: text }),
    ]);
  }

  function tag(text, kind) { return el("span", { cls: "tag tag--" + kind, text: text }); }

  function card(item, profile) {
    var tpl = $("card-template").content.firstElementChild.cloneNode(true);
    var m = item.match;
    tpl.dataset.cat = m.category;
    tpl.classList.toggle("is-muted", item.mark.done || item.mark.dismissed);
    tpl.classList.toggle("is-synthetic", !!item.synthetic);

    var tags = tpl.querySelector(".card__tags");
    if (item.synthetic) tags.appendChild(tag("Synthetic sample", "synthetic"));
    if (m.direct) tags.appendChild(tag("Names " + (profile.child_first_name || "your child"), "direct"));
    if (m.year_match) tags.appendChild(tag("Year " + profile.year_group, "year"));
    m.activities.forEach(function (a) { tags.appendChild(tag("Possible relevance · " + a, "activity")); });
    if (m.category === "general") tags.appendChild(tag("General", "general"));
    if (!m.year_match && m.years_mentioned.length) {
      tags.appendChild(tag(m.years_mentioned.map(function (y) { return "Y" + y; }).join(", "), "other"));
    }
    if (item.mark.saved) tags.appendChild(tag("Saved", "state"));
    if (item.mark.done) tags.appendChild(tag("Done", "state"));
    if (item.mark.dismissed) tags.appendChild(tag("Dismissed", "state"));

    tpl.querySelector(".card__subject").textContent = item.subject;
    var meta = [item.from_name || item.from_address || "Unknown sender", "Received " + formatDate(item.received_at)];
    if (item.direction === "outgoing") meta.push("Sent by you");
    if (item.message_count > 1) meta.push(item.message_count + " messages in thread");
    if (item.you_replied_at) meta.push("You replied " + formatDate(item.you_replied_at));
    if (item.accounts && item.accounts.length > 1) meta.push("In " + item.accounts.join(" & "));
    tpl.querySelector(".card__meta").textContent = meta.join(" · ");
    tpl.querySelector(".card__excerpt").textContent = item.excerpt || "(No text content — open the email to view.)";

    if (m.possible_actions.length) {
      var act = tpl.querySelector(".card__action");
      act.hidden = false;
      act.appendChild(el("strong", { text: "Possible action — check email." }));
      act.appendChild(document.createTextNode(" Mentions: " + m.possible_actions.join(", ") +
        ". This is a keyword hint, not a confirmed task or deadline."));
    }
    if (item.attachments_skipped) {
      var at = tpl.querySelector(".card__attach");
      at.hidden = false;
      at.textContent = "📎 " + item.attachments_skipped + " attachment" + (item.attachments_skipped > 1 ? "s" : "") +
        " not read by the dashboard — open the email to see " + (item.attachments_skipped > 1 ? "them." : "it.");
    }

    var ul = tpl.querySelector(".card__why ul");
    m.reasons.forEach(function (r) { ul.appendChild(el("li", { text: r.text })); });
    if (item.body_source === "html") ul.appendChild(el("li", { text: "Text extracted from the HTML version of the email." }));

    var open = tpl.querySelector(".card__open");
    if (item.source_url && /^https:\/\/mail\.google\.com\//.test(item.source_url)) {
      open.href = item.source_url;
      open.setAttribute("aria-label", "Open “" + item.subject + "” in Gmail (new tab)");
    } else {
      open.replaceWith(el("span", { cls: "hint", text: item.synthetic ? "Synthetic — no source email" : "No link available" }));
    }

    var body = tpl.querySelector(".card__body");
    var pre = tpl.querySelector(".card__text");
    var histBtn = tpl.querySelector(".card__history");
    var expandBtn = tpl.querySelector(".card__expand");
    var hasHistory = item.full_text && item.full_text.trim() !== (item.new_text || "").trim();
    function paintBody() {
      var isOpen = !!state.expanded[item.key];
      body.hidden = !isOpen;
      expandBtn.setAttribute("aria-expanded", String(isOpen));
      expandBtn.textContent = isOpen ? "Hide text" : "Read here";
      var withHistory = !!state.history[item.key];
      pre.textContent = (withHistory ? item.full_text : item.new_text) || item.excerpt || "";
      histBtn.hidden = !hasHistory;
      histBtn.textContent = withHistory ? "Hide earlier messages / signature" : "Show earlier messages / signature";
    }
    paintBody();
    expandBtn.addEventListener("click", function () { state.expanded[item.key] = !state.expanded[item.key]; paintBody(); });
    histBtn.addEventListener("click", function () { state.history[item.key] = !state.history[item.key]; paintBody(); });

    markButton(tpl.querySelector(".card__save"), item, "saved", "Save", "Saved");
    markButton(tpl.querySelector(".card__done"), item, "done", "Mark done", "Done ✓");
    markButton(tpl.querySelector(".card__dismiss"), item, "dismissed", "Dismiss", "Restore");
    return tpl;
  }

  function markButton(btn, item, field, offLabel, onLabel) {
    var on = !!item.mark[field];
    btn.textContent = on ? onLabel : offLabel;
    btn.setAttribute("aria-pressed", String(on));
    btn.addEventListener("click", function () {
      var changes = {};
      changes[field] = !item.mark[field];
      btn.disabled = true;
      api("/api/marks", { key: item.key, changes: changes }).then(function (res) {
        item.mark = { saved: !!res.mark.saved, done: !!res.mark.done, dismissed: !!res.mark.dismissed };
        render();
      }).catch(function (err) {
        btn.disabled = false;
        showTransientAlert("Couldn't save that change: " + err.message);
      });
    });
  }

  function renderActivityChips(profile) {
    var box = $("activity-chips");
    box.textContent = "";
    var acts = profile.activities || [];
    $("activity-empty").hidden = acts.length > 0;
    if (state.activity && acts.indexOf(state.activity) === -1) state.activity = null;
    acts.forEach(function (a) {
      var b = el("button", { cls: "chip", text: a, attrs: { type: "button", "aria-pressed": String(state.activity === a) } });
      b.addEventListener("click", function () { state.activity = state.activity === a ? null : a; render(); });
      box.appendChild(b);
    });
  }

  function clearFilters() {
    state.search = ""; state.actionsOnly = false; state.savedOnly = false; state.activity = null;
    $("search").value = ""; $("f-actions").checked = false; $("f-saved").checked = false;
    render();
  }

  // ---------- tabs ----------
  function selectView(view, focus) {
    state.view = view;
    document.querySelectorAll(".tab").forEach(function (t) {
      var on = t.dataset.view === view;
      t.setAttribute("aria-selected", String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    try { localStorage.setItem("kingsdash.view", view); } catch (e) { /* storage unavailable */ }
    render();
  }

  // ---------- settings ----------
  var dialog = $("settings");
  var lastFocus = null;

  function openSettings() {
    lastFocus = document.activeElement;
    $("settings-error").hidden = true;
    api("/api/settings").then(function (cfg) {
      $("s-name").value = cfg.profile.child_first_name || "";
      $("s-year").value = String(cfg.profile.year_group);
      $("s-activities").value = (cfg.profile.activities || []).join("\n");
      $("s-accounts").value = (cfg.accounts || []).join("\n");
      $("s-query").value = cfg.query || DEFAULT_QUERY;
      $("s-minutes").value = String(cfg.refresh_minutes);
      $("s-demo").checked = !!cfg.demo_mode;
      dialog.dataset.prevAccounts = JSON.stringify(cfg.accounts);
      dialog.dataset.prevQuery = cfg.query;
      dialog.dataset.prevDemo = String(cfg.demo_mode);
      if (typeof dialog.showModal === "function") dialog.showModal(); else dialog.setAttribute("open", "");
      $("s-name").focus();
    }).catch(function (err) { showTransientAlert("Couldn't load settings: " + err.message); });
  }

  function closeSettings() {
    if (dialog.open) dialog.close();
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function lines(v) { return v.split(/[\n,;]+/).map(function (s) { return s.trim(); }).filter(Boolean); }

  function saveSettings(ev) {
    ev.preventDefault();
    var minutes = parseInt($("s-minutes").value, 10);
    var payload = {
      profile: {
        child_first_name: $("s-name").value.trim(),
        year_group: parseInt($("s-year").value, 10),
        activities: $("s-activities").value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean),
      },
      accounts: lines($("s-accounts").value),
      query: $("s-query").value.trim() || DEFAULT_QUERY,
      refresh_minutes: isNaN(minutes) ? 30 : minutes,
      demo_mode: $("s-demo").checked,
    };
    var save = $("settings-save");
    save.disabled = true;
    api("/api/settings", payload).then(function (cfg) {
      save.disabled = false;
      var syncChanged = JSON.stringify(cfg.accounts) !== dialog.dataset.prevAccounts ||
        cfg.query !== dialog.dataset.prevQuery || String(cfg.demo_mode) !== dialog.dataset.prevDemo;
      closeSettings();
      if (syncChanged && !cfg.demo_mode && cfg.accounts.length) {
        refresh();
      } else {
        load();
      }
    }).catch(function (err) {
      save.disabled = false;
      var box = $("settings-error");
      box.textContent = err.message;
      box.hidden = false;
      box.focus && box.focus();
    });
  }

  // ---------- wiring ----------
  function init() {
    var sel = $("s-year");
    for (var y = 1; y <= 13; y++) sel.appendChild(el("option", { text: "Year " + y, attrs: { value: String(y) } }));

    try {
      var saved = localStorage.getItem("kingsdash.view");
      if (saved === "child" || saved === "year" || saved === "all") state.view = saved;
    } catch (e) { /* storage unavailable */ }
    selectView(state.view, false);

    var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
    tabs.forEach(function (t, i) {
      t.addEventListener("click", function () { selectView(t.dataset.view, false); });
      t.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowRight") next = tabs[(i + 1) % tabs.length];
        else if (e.key === "ArrowLeft") next = tabs[(i - 1 + tabs.length) % tabs.length];
        else if (e.key === "Home") next = tabs[0];
        else if (e.key === "End") next = tabs[tabs.length - 1];
        if (next) { e.preventDefault(); selectView(next.dataset.view, true); }
      });
    });

    var searchTimer = null;
    $("search").addEventListener("input", function (e) {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { state.search = e.target.value.trim(); render(); }, 150);
    });
    $("f-actions").addEventListener("change", function (e) { state.actionsOnly = e.target.checked; render(); });
    $("f-saved").addEventListener("change", function (e) { state.savedOnly = e.target.checked; render(); });
    $("f-hidden").addEventListener("change", function (e) { state.includeHidden = e.target.checked; render(); });

    $("refresh-btn").addEventListener("click", refresh);
    $("settings-btn").addEventListener("click", openSettings);
    $("settings-close").addEventListener("click", closeSettings);
    $("settings-cancel").addEventListener("click", closeSettings);
    $("settings-form").addEventListener("submit", saveSettings);
    $("s-query-reset").addEventListener("click", function () { $("s-query").value = DEFAULT_QUERY; });
    dialog.addEventListener("close", function () { if (lastFocus && lastFocus.focus) lastFocus.focus(); });
    $("settings-error").tabIndex = -1;

    document.addEventListener("visibilitychange", function () { if (!document.hidden) load(); });
    load();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
