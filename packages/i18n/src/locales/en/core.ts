/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

export default {
  sidebar: {
    weekly: "Weekly",
    projects: "Projects",
    pages: "Pages",
    new_work_item: "New work item",
    home: "Home",
    my_work: "My Work",
    your_work: "Your work",
    inbox: "Inbox",
    workspace: "Workspace",
    views: "Views",
    analytics: "Analytics",
    work_items: "Work items",
    cycles: "Cycles",
    modules: "Modules",
    intake: "Intake",
    recurring: "Recurring",
    drafts: "Drafts",
    favorites: "Favorites",
    pro: "Pro",
    upgrade: "Upgrade",
    stickies: "Stickies",
  },

  // BARSOUL 週次ミーティング支援 (weekly meeting suite)
  weekly: {
    buckets: { done: "Completed", progress: "In progress", discussion: "Discussion" },
    sources: { title: "Sources", empty: "No activity in this period." },
    members: { title: "Members" },
    states: {
      idle: "No draft",
      queued: "Waiting to generate",
      running: "Generating",
      ready: "Draft ready",
      confirmed: "Final version saved",
      failed: "Generation failed",
    },
    stats: { done: "Completed", progress: "In progress", discussion: "Discussion", confirmed: "Final versions" },
    tabs: { draft: "AI draft", final: "Final version" },
    status: {
      open: "Open",
      confirmed: "Confirmed",
      frozen_hint: "This week is confirmed and frozen. Undo the confirmation to keep editing.",
    },
    draft: {
      regenerate: "Regenerate",
      regenerate_hint: "Rebuild this member's draft from the latest activity.",
      running: "Writing the draft\u2026",
      queued: "Waiting in the generation queue\u2026",
      queued_toast: "Queued for generation",
      failed: "The draft could not be generated",
      failed_hint: "The sources are still complete \u2014 you can write the final version from them.",
      retry: "Try again",
      empty: "No draft for this period",
      empty_hint: "There was nothing to summarize, or the draft has not been generated yet.",
      note: "AI draft \u2014 check it against the sources before writing the final version.",
    },
    final: {
      empty: "No final version yet",
      empty_hint: "The final version is the record this week leaves behind: regenerating a draft never overwrites it, and confirming the week freezes it.",
      note: "This is the final version — the record that stays. Regenerating the draft does not touch it.",
      write: "Write it",
      from_draft: "Start from the draft",
      edit: "Edit",
      save: "Save",
      cancel: "Cancel",
      saved: "Final version saved",
      save_failed: "Could not save",
      placeholder: "# Completed\n- What happened [ABC-12]",
      syntax_hint: "Lines starting with # are headings, lines starting with - are bullets. Keys like [ABC-12] stay linked to their work items.",
    },
    notes: {
      open: "Notes",
      open_hint: "Open this meeting's notes page",
      create: "Notes",
      create_hint: "Create a notes page for this meeting",
      pick_project: "Where should the notes live?",
      created: "Notes page created",
    },
    chat: {
      title: "Discussion",
      close: "Close discussion",
      empty: "Nothing said yet. Anything typed here is translated for the rest of the room.",
      placeholder: "Say something…",
      hint: "Enter to send, Shift+Enter for a new line. Japanese and Chinese are translated both ways.",
      send: "Send",
      failed: "Could not send",
      closed: "This week is confirmed, so the discussion is closed.",
    },
    actions: {
      open: "New meeting",
      opened: "Meeting opened",
      confirm: "Confirm",
      confirm_hint: "Close this meeting. The next period starts from here.",
      confirmed: "Meeting confirmed",
      refresh: "Rebuild",
      refresh_hint: "Recollect activity and regenerate every draft.",
      refresh_queued: "Drafts queued \u2014 this takes a few minutes",
      refresh_sources: "Sources only",
      refresh_sources_hint: "Recollect activity without regenerating the drafts (fast).",
      refreshed: "Sources updated",
      failed: "The action could not be completed",
      reopen: "Undo confirmation",
      reopened: "Confirmation undone",
      reopen_conflict: "A newer week is already open, so this one cannot be reopened. Delete or confirm that week first.",
      delete: "Delete this week",
      deleting: "Deleting…",
      deleted: "Week deleted",
      delete_modal: "This week will be removed along with its drafts. Only a week nobody has written in can be deleted.",
      delete_conflict: "This week already has a final version or chat, so it cannot be deleted.",
      rename: "Rename this week",
      rename_placeholder: "e.g. Weekly sync, Jul week 4",
      confirm_modal: "Confirming freezes this week: drafts and final versions can no longer be edited, and the next week starts from now. The final versions stay as this week’s record.",
      confirming: "Confirming…",
    },
    empty: {
      title: "No meeting yet",
      hint: "Open a meeting to collect what everyone has worked on since the last one.",
      no_entries: "No members in this meeting.",
    },
  },

  auth: {
    common: {
      email: {
        label: "Email",
        placeholder: "name@company.com",
        errors: {
          required: "Email is required",
          invalid: "Email is invalid",
        },
      },
      password: {
        label: "Password",
        set_password: "Set a password",
        placeholder: "Enter password",
        confirm_password: {
          label: "Confirm password",
          placeholder: "Confirm password",
        },
        current_password: {
          label: "Current password",
        },
        new_password: {
          label: "New password",
          placeholder: "Enter new password",
        },
        change_password: {
          label: {
            default: "Change password",
            submitting: "Changing password",
          },
        },
        errors: {
          match: "Passwords don't match",
          empty: "Please enter your password",
          length: "Password length should me more than 8 characters",
          strength: {
            weak: "Password is weak",
            strong: "Password is strong",
          },
        },
        submit: "Set password",
        toast: {
          change_password: {
            success: {
              title: "Success!",
              message: "Password changed successfully.",
            },
            error: {
              title: "Error!",
              message: "Something went wrong. Please try again.",
            },
          },
        },
      },
      unique_code: {
        label: "Unique code",
        placeholder: "123456",
        paste_code: "Paste the code sent to your email",
        requesting_new_code: "Requesting new code",
        sending_code: "Sending code",
      },
      already_have_an_account: "Already have an account?",
      login: "Log in",
      create_account: "Create an account",
      new_to_plane: "New to Plane?",
      back_to_sign_in: "Back to sign in",
      resend_in: "Resend in {seconds} seconds",
      sign_in_with_unique_code: "Sign in with unique code",
      forgot_password: "Forgot your password?",
    },
    sign_up: {
      header: {
        label: "Create an account to start managing work with your team.",
        step: {
          email: {
            header: "Sign up",
            sub_header: "",
          },
          password: {
            header: "Sign up",
            sub_header: "Sign up using an email-password combination.",
          },
          unique_code: {
            header: "Sign up",
            sub_header: "Sign up using a unique code sent to the email address above.",
          },
        },
      },
      errors: {
        password: {
          strength: "Try setting-up a strong password to proceed",
        },
      },
    },
    sign_in: {
      header: {
        label: "Log in to start managing work with your team.",
        step: {
          email: {
            header: "Log in or sign up",
            sub_header: "",
          },
          password: {
            header: "Log in or sign up",
            sub_header: "Use your email-password combination to log in.",
          },
          unique_code: {
            header: "Log in or sign up",
            sub_header: "Log in using a unique code sent to the email address above.",
          },
        },
      },
    },
    forgot_password: {
      title: "Reset your password",
      description: "Enter your user account's verified email address and we will send you a password reset link.",
      email_sent: "We sent the reset link to your email address",
      send_reset_link: "Send reset link",
      errors: {
        smtp_not_enabled: "We see that your god hasn't enabled SMTP, we will not be able to send a password reset link",
      },
      toast: {
        success: {
          title: "Email sent",
          message:
            "Check your inbox for a link to reset your password. If it doesn't appear within a few minutes, check your spam folder.",
        },
        error: {
          title: "Error!",
          message: "Something went wrong. Please try again.",
        },
      },
    },
    reset_password: {
      title: "Set new password",
      description: "Secure your account with a strong password",
    },
    set_password: {
      title: "Secure your account",
      description: "Setting password helps you login securely",
    },
    sign_out: {
      toast: {
        error: {
          title: "Error!",
          message: "Failed to sign out. Please try again.",
        },
      },
    },
  },
} as const;
