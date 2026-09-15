/**
 * Shared behaviour for Slate's public pages.
 *
 * Two jobs:
 *   1. Substitute configured values into {{placeholders}} in the markup.
 *   2. Make it impossible to quietly ship a half-configured site — any page
 *      that still contains an unfilled required value shows a warning
 *      banner naming the missing keys.
 */
(function () {
  "use strict";

  var cfg = window.SLATE_CONFIG || {};

  /** Keys every page needs before it is fit to publish. */
  var REQUIRED = ["legalEntity", "contactEmail", "effectiveDate", "siteBaseUrl"];

  function missingKeys(extra) {
    return REQUIRED.concat(extra || []).filter(function (k) {
      return !cfg[k] || String(cfg[k]).trim() === "";
    });
  }

  /** Replaces {{key}} tokens in text nodes only — never in markup. */
  function substitute(root) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var node;
    var pending = [];
    while ((node = walker.nextNode())) {
      if (node.nodeValue.indexOf("{{") !== -1) pending.push(node);
    }
    pending.forEach(function (n) {
      n.nodeValue = n.nodeValue.replace(/\{\{(\w+)\}\}/g, function (whole, key) {
        var value = cfg[key];
        return value && String(value).trim() !== "" ? value : "[NOT CONFIGURED: " + key + "]";
      });
    });
  }

  function renderBanner(missing) {
    if (missing.length === 0) return;
    var banner = document.createElement("div");
    banner.className = "banner";
    banner.setAttribute("role", "alert");
    banner.innerHTML =
      "<strong>This page is not configured for publication.</strong> " +
      "The following values in <code>web/config.js</code> are still blank: <code>" +
      missing.join("</code>, <code>") +
      "</code>. Fill them in and run <code>node web/verify-config.mjs</code> before deploying.";
    var main = document.querySelector("main .wrap") || document.querySelector(".wrap");
    if (main) main.insertBefore(banner, main.firstChild);
  }

  function linkifyEmails() {
    document.querySelectorAll("[data-mailto]").forEach(function (el) {
      var key = el.getAttribute("data-mailto");
      var address = cfg[key];
      if (address && String(address).trim() !== "") {
        var a = document.createElement("a");
        a.href = "mailto:" + address;
        a.textContent = address;
        el.replaceChildren(a);
      } else {
        el.textContent = "[NOT CONFIGURED: " + key + "]";
      }
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    substitute(document.body);
    linkifyEmails();
    var extra = (document.body.getAttribute("data-requires") || "")
      .split(",")
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    renderBanner(missingKeys(extra));
  });

  window.SlateSite = {
    config: cfg,
    missingKeys: missingKeys,
  };
})();
