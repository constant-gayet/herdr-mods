// My PRs: your open GitHub pull requests, and the ones waiting on your review,
// in the Herdr app. Opens as a popup with mod.open:my-prs, or as a side panel
// next to Files and Changes (see the README). Narrow, rows go compact.
// ↑/↓ or j/k to move, Enter or a click opens the PR in the browser,
// y copies its link, r refreshes, Esc closes a popup.
//
// Uses the gh CLI's sign-in. Settings, all optional, in
// ~/.config/herdr-app/my-prs.json:
//   { "query": "<GitHub search>", "me": "<your login>", "refresh_seconds": 120, "demo": false }

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, ScrollHandle } from "gpui-base";
import { exec, theme, props, closeOverlay, nextCommand, settings, appHome, readTextFile } from "herdr";

const DEFAULT_QUERY = "is:pr is:open archived:false (author:@me OR review-requested:@me)";
const DEFAULT_REFRESH_SECONDS = 120;
const GRAPHQL = `query($q: String!) {
  search(query: $q, type: ISSUE_ADVANCED, first: 100) {
    nodes { ... on PullRequest {
      number title url isDraft updatedAt reviewDecision mergeable
      author { login }
      latestOpinionatedReviews(first: 20) { nodes { state } }
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    } }
  }
}`;

async function loadConfig() {
  try {
    const text = await readTextFile(`${appHome()}/my-prs.json`);
    return text ? JSON.parse(text) : {};
  } catch (e) {
    return { error: `my-prs.json: ${e?.message ?? e}` };
  }
}

// Made-up pull requests for trying the mod and for screenshots: nothing real.
function demoPrs() {
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const pr = (number, title, author, h, extra = {}) => ({
    number, title, author: { login: author }, updatedAt: ago(h), url: `https://github.com/acme/shop/pull/${number}`,
    isDraft: false, reviewDecision: "REVIEW_REQUIRED", mergeable: "MERGEABLE", latestOpinionatedReviews: { nodes: [] },
    commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] }, ...extra,
  });
  const ci = (state) => ({ commits: { nodes: [{ commit: { statusCheckRollup: { state } } }] } });
  const approvals = (n) => ({ latestOpinionatedReviews: { nodes: Array.from({ length: n }, () => ({ state: "APPROVED" })) } });
  return [
    pr(482, "feat(checkout): pay with saved cards", "you", 0.4, { reviewDecision: "APPROVED", ...approvals(2) }),
    pr(479, "fix(cart): keep the basket when the session expires", "you", 3, { ...ci("PENDING"), ...approvals(1) }),
    pr(471, "refactor(search): one query builder for every filter", "you", 26, { ...ci("FAILURE"), mergeable: "CONFLICTING" }),
    pr(466, "chore(deps): bump the payment SDK to v5", "you", 50, { isDraft: true, reviewDecision: null }),
    pr(485, "feat(orders): export the order history as CSV", "alice", 1.5),
    pr(477, "fix(auth): refresh tokens before they expire", "bob", 20, { reviewDecision: "CHANGES_REQUESTED" }),
  ];
}

function age(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default class MyPrs extends View {
  init(_props, cx) {
    this.prs = [];
    this.error = null;
    this.loading = true;
    this.at = 0;
    this.loadedAt = null;
    this.status = "";
    this.handle = cx.focus_handle();
    this.scroll = ScrollHandle.new();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
    this.me = null;
    cx.timer.every(1000, (cx) => {
      if (!this.loading && Date.now() - this.lastTry >= this.refreshMs) this.refresh(cx);
    });
    this.refreshMs = DEFAULT_REFRESH_SECONDS * 1000;
    this.width = 900;
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "focus") this.handle.focus();
        if (c === "refresh") this.refresh(cx);
        cx.notify();
      }
    });
    this.refresh(cx);
  }

  refresh(cx) {
    this.lastTry = Date.now();
    this.loading = true;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const config = await loadConfig();
        if (config.error) throw new Error(config.error);
        this.refreshMs = Math.max(30, Number(config.refresh_seconds) || DEFAULT_REFRESH_SECONDS) * 1000;
        let nodes;
        if (config.demo) {
          this.me = "you";
          nodes = demoPrs();
        } else {
          if (config.me) this.me = config.me;
          if (!this.me) {
            const who = await exec("gh", ["api", "user", "--jq", ".login"], { timeout: 30000 });
            if (who.code !== 0) throw new Error((who.stderr || "gh is not signed in: run gh auth login").trim());
            this.me = who.stdout.trim();
          }
          const r = await exec("gh", ["api", "graphql", "-f", `q=${config.query || DEFAULT_QUERY}`, "-f", `query=${GRAPHQL}`], { timeout: 30000 });
          const out = JSON.parse(r.stdout || "{}");
          if (out.errors?.length) throw new Error(out.errors.map((e) => e.message).join("; "));
          if (r.code !== 0 || !out.data) throw new Error((r.stderr || r.stdout || "gh failed").trim());
          nodes = out.data.search.nodes;
        }
        const mine = (p) => (p.author?.login === this.me ? 0 : 1);
        this.prs = nodes
          .filter((p) => p.number)
          .sort((a, b) => mine(a) - mine(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        this.error = null;
        this.loadedAt = Date.now();
      } catch (e) {
        this.error = String(e?.message ?? e);
      }
      this.loading = false;
      this.at = Math.min(this.at, Math.max(0, this.prs.length - 1));
      cx.notify();
    });
  }

  close() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  open(pr) {
    if (pr) exec("sh", ["-c", 'if command -v xdg-open >/dev/null; then xdg-open "$1"; else open "$1"; fi', "_", pr.url]);
  }

  copy(pr, cx) {
    if (!pr) return;
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", 'printf %s "$1" | (pbcopy 2>/dev/null || wl-copy 2>/dev/null || xclip -selection clipboard 2>/dev/null || xsel -ib)', "_", pr.url]);
      this.status = r.code === 0 ? `Copied #${pr.number}` : "No clipboard tool (pbcopy, wl-copy, xclip or xsel)";
      cx.notify();
    });
  }

  ci(t, pr) {
    const s = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state;
    if (s === "SUCCESS") return div().w(14).text_color(t.ansi2).child("✓");
    if (s === "FAILURE" || s === "ERROR") return div().w(14).text_color(t.ansi1).child("✗");
    if (s === "PENDING" || s === "EXPECTED") return div().w(14).text_color(t.ansi3).child("●");
    return div().w(14);
  }

  // Approved: GitHub's review decision. Not yet: an empty circle, with how
  // many approvals it already has when it has some.
  approval(t, pr) {
    const cell = h_flex().w(56).gap(4).items_center();
    if (pr.reviewDecision === "APPROVED") return cell.child(svg("mods/my-prs/approved.svg").size(15).text_color(t.ansi2));
    const n = (pr.latestOpinionatedReviews?.nodes ?? []).filter((r) => r.state === "APPROVED").length;
    return cell
      .child(svg("mods/my-prs/not-approved.svg").size(15).text_color(n ? t.ansi3 : t.dim))
      .when(n > 0 && this.width >= 640, (el) => el.child(div().text_size(11).text_color(t.ansi3).child(String(n))));
  }

  review(t, pr) {
    if (pr.isDraft) return div().w(72).text_color(t.dim).child("draft");
    if (pr.reviewDecision === "APPROVED") return div().w(72).text_color(t.ansi2).child("approved");
    if (pr.reviewDecision === "CHANGES_REQUESTED") return div().w(72).text_color(t.ansi1).child("changes");
    return div().w(72).text_color(t.ansi3).child("to review");
  }

  row(t, pr, i) {
    return this.width < 640 ? this.compactRow(t, pr, i) : this.wideRow(t, pr, i);
  }

  // Two lines for a narrow panel: number, author, CI, approval, age; then the title.
  compactRow(t, pr, i) {
    const on = i === this.at;
    const mine = pr.author?.login === this.me;
    return v_flex()
      .id(`pr-${pr.number}`)
      .px(8)
      .py(5)
      .gap(2)
      .flex_none()
      .rounded(7)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.at = i;
        this.open(pr);
        cx.notify();
      })
      .child(
        h_flex().gap(8).items_center().text_size(12)
          .child(div().font_semibold().text_color(t.accent).child(`#${pr.number}`))
          .child(div().flex_1().truncate().text_color(mine ? t.ansi4 : t.ansi5).child(mine ? "mine" : `@${pr.author?.login ?? "?"}`))
          .child(this.ci(t, pr))
          .child(this.approval(t, pr).w(40))
          .child(div().w(14).text_color(t.ansi1).child(pr.mergeable === "CONFLICTING" ? "⚠" : ""))
          .child(div().w(30).text_color(t.dim).child(age(pr.updatedAt))),
      )
      .child(div().truncate().text_size(12.5).text_color(pr.isDraft ? t.dim : t.foreground).child(pr.isDraft ? `[draft] ${pr.title}` : pr.title));
  }

  wideRow(t, pr, i) {
    const on = i === this.at;
    const mine = pr.author?.login === this.me;
    return h_flex()
      .id(`pr-${pr.number}`)
      .px(10)
      .h(32)
      .flex_none()
      .gap(10)
      .items_center()
      .rounded(7)
      .cursor_pointer()
      .when(on, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => {
        this.at = i;
        this.open(pr);
        cx.notify();
      })
      .child(div().w(56).font_semibold().text_color(t.accent).child(`#${pr.number}`))
      .child(div().w(120).truncate().text_color(mine ? t.ansi4 : t.ansi5).child(mine ? "mine" : `@${pr.author?.login ?? "?"}`))
      .child(this.ci(t, pr))
      .child(this.approval(t, pr))
      .child(this.review(t, pr))
      .child(div().w(14).text_color(t.ansi1).child(pr.mergeable === "CONFLICTING" ? "⚠" : ""))
      .child(div().w(34).text_color(t.dim).child(age(pr.updatedAt)))
      .child(div().flex_1().truncate().text_color(t.foreground).child(pr.title));
  }

  render() {
    const t = theme();
    const n = this.prs.length;
    const mineCount = this.prs.filter((p) => p.author?.login === this.me).length;
    const sub = this.loading
      ? "loading…"
      : this.error
        ? "error"
        : `${mineCount} mine · ${n - mineCount} to review${this.loadedAt ? ` · updated ${age(new Date(this.loadedAt).toISOString())} ago` : ""}`;
    const key = (k, what) => h_flex().gap(4).child(div().px(5).rounded(4).bg(t.raised).text_color(t.muted).child(k)).child(div().child(what));

    return v_flex()
      .id("my-prs")
      .track_focus(this.handle)
      .on_size_change((size, cx) => {
        const w = size.width / settings().zoom;
        if (Math.abs(w - this.width) > 1) {
          this.width = w;
          cx.notify();
        }
      })
      .w_full()
      .min_h(0)
      .when(!!props()?.overlay, (el) => el.p(16).bg(t.popover))
      .when(!props()?.overlay, (el) => el.h_full().p(10).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border))
      .gap(10)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        if (k === "down" || k === "j") this.at = Math.min(this.at + 1, n - 1);
        else if (k === "up" || k === "k") this.at = Math.max(this.at - 1, 0);
        else if (k === "enter") this.open(this.prs[this.at]);
        else if (k === "y") this.copy(this.prs[this.at], cx);
        else if (k === "r") return (cx.stop_propagation(), this.refresh(cx));
        else return;
        if (n) this.scroll.scroll_to_item(this.at);
        cx.stop_propagation();
        cx.notify();
      })
      .child(
        h_flex().items_center().gap(10)
          .child(div().text_size(15).font_semibold().text_color(t.foreground).child("My PRs"))
          .child(div().flex_1().text_size(11.5).text_color(t.dim).child(sub))
          .child(div().id("my-prs-refresh").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => this.refresh(cx)).child("Refresh"))
          .when(!!props()?.overlay, (el) => el.child(div().id("my-prs-esc").px(6).py(2).rounded(5).text_size(11).text_color(t.dim).cursor_pointer()
            .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => this.close()).child("Esc"))),
      )
      .when(!!this.error, (el) => el.child(div().text_color(t.ansi1).child(this.error)))
      .when(!this.error && !this.loading && n === 0, (el) => el.child(div().text_color(t.dim).child("Nothing open. 🎉")))
      .when(n > 0 && this.width >= 640, (el) => el.child(
        h_flex().px(10).gap(10).text_size(10.5).text_color(t.dim)
          .child(div().w(56).child("PR")).child(div().w(120).child("Author")).child(div().w(14).child("CI"))
          .child(div().w(56).child("Approved")).child(div().w(72).child("Review")).child(div().w(14))
          .child(div().w(34).child("Age")).child(div().flex_1().child("Title")),
      ))
      .child(
        v_flex().id("my-prs-list").min_h(0).overflow_y_scrollbar()
          .when(!!props()?.overlay, (el) => el.h(Math.min(Math.max(n, 1) * 32, 520)))
          .when(!props()?.overlay, (el) => el.flex_1()).track_scroll(this.scroll)
          .children(this.prs.map((pr, i) => this.row(t, pr, i))),
      )
      .child(
        h_flex().gap(10).text_size(11).text_color(t.dim)
          .child(key("↑↓", "move")).child(key("enter", "open")).child(key("y", "copy")).child(key("r", "refresh"))
          .child(div().flex_1()).child(div().text_color(t.muted).child(this.status)),
      );
  }
}
