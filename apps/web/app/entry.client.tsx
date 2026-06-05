/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { startTransition, StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

// The hydration mismatch (#418/#423) is fixed by having root.tsx export a
// `clientLoader.hydrate = true`, which makes React Router show
// <HydrateFallback /> during the hydrate phase (matching the empty server
// shell) and only render the real tree afterwards.

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <HydratedRouter />
    </StrictMode>
  );
});
