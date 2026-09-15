/**
 * The web account-deletion flow required by Google Play policy for apps
 * that let users create an account.
 *
 * This is the same operation the app performs: sign in with the account's
 * own credentials, then POST /users/me/delete with an explicit DELETE
 * confirmation. The deletion happens server-side in one transaction. No
 * support ticket, no waiting period, no human in the loop.
 *
 * Credentials are used for exactly two requests and are never stored:
 * nothing is written to localStorage, sessionStorage or a cookie, and the
 * access token lives only in a local variable for the duration of the
 * submit handler.
 */
(function () {
  "use strict";

  var form = document.getElementById("delete-form");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var confirmInput = document.getElementById("confirm");
  var submitButton = document.getElementById("submit");
  var statusBox = document.getElementById("status");

  var cfg = window.SLATE_CONFIG || {};
  var apiBaseUrl = (cfg.apiBaseUrl || "").replace(/\/$/, "");

  function setStatus(kind, html) {
    statusBox.className = "status " + kind;
    statusBox.innerHTML = html;
    statusBox.hidden = false;
  }

  function clearStatus() {
    statusBox.hidden = true;
    statusBox.innerHTML = "";
  }

  if (!apiBaseUrl) {
    // Without an API origin the form cannot work. Say so plainly rather
    // than presenting a button that silently does nothing.
    submitButton.disabled = true;
    setStatus(
      "error",
      "This page is not finished being set up: <code>apiBaseUrl</code> is blank in " +
        "<code>web/config.js</code>, so the deletion request has nowhere to go. " +
        "Deletion is still available in the Slate app under Profile → Settings → Delete account."
    );
    return;
  }

  async function post(path, body, token) {
    var headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    var res = await fetch(apiBaseUrl + path, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
    });
    var data = null;
    try {
      data = await res.json();
    } catch (e) {
      data = null;
    }
    return { ok: res.ok, status: res.status, data: data };
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    clearStatus();

    if (confirmInput.value.trim() !== "DELETE") {
      setStatus("error", "Type <code>DELETE</code> in the confirmation box to continue.");
      return;
    }

    var warning =
      "This permanently deletes your Slate account and cannot be undone.\n\n" +
      "If you subscribe to Slate Pro, deleting your account does NOT cancel it. " +
      "Cancel the subscription in the Google Play Store as well, or you will keep being charged.\n\n" +
      "Delete your account now?";
    if (!window.confirm(warning)) return;

    submitButton.disabled = true;
    submitButton.textContent = "Deleting…";

    try {
      var login = await post("/auth/login", {
        email: emailInput.value.trim(),
        password: passwordInput.value,
      });

      if (!login.ok || !login.data || !login.data.accessToken) {
        setStatus(
          "error",
          login.status === 429
            ? "Too many attempts. Wait a few minutes and try again."
            : "That email and password did not match a Slate account. " +
                "Check them and try again — for your protection Slate does not say which one was wrong."
        );
        return;
      }

      var del = await post(
        "/users/me/delete",
        { password: passwordInput.value, confirm: "DELETE" },
        login.data.accessToken
      );

      if (!del.ok) {
        setStatus(
          "error",
          del.status === 429
            ? "Too many attempts. Wait a few minutes and try again."
            : "Slate could not delete the account right now. Please try again, or email support " +
                "and we will delete it for you."
        );
        return;
      }

      var extra = del.data && del.data.hadActiveSubscription
        ? "<p><strong>Your Slate Pro subscription was still active.</strong> Deleting your account " +
          "does not cancel it — open the Google Play Store, go to Payments &amp; subscriptions, " +
          "and cancel Slate Pro, or Google will keep charging you.</p>"
        : "";

      setStatus(
        "ok",
        "<p><strong>Your account has been deleted.</strong> Your email address, password, " +
          "sessions, follows, watchlist, journeys, notifications and Ask Slate history are gone, " +
          "and anything you posted has been anonymised. You can no longer sign in with this " +
          "account.</p>" + extra
      );
      form.reset();
      form.hidden = true;
    } catch (err) {
      setStatus(
        "error",
        "Slate could not reach the server. Check your connection and try again, or email support."
      );
    } finally {
      submitButton.disabled = false;
      submitButton.textContent = "Delete my Slate account";
      passwordInput.value = "";
    }
  });
})();
