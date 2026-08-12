import * as Context from "effect/Context";
import type * as Option from "effect/Option";
import type * as Stream from "effect/Stream";

import type { PrimaryConnectionRegistration } from "../connection/catalog.ts";

export class PlatformConnectionSource extends Context.Service<
  PlatformConnectionSource,
  {
    readonly registration: Stream.Stream<Option.Option<PrimaryConnectionRegistration>>;
  }
>()("@t3tools/client-runtime/platform/source/PlatformConnectionSource") {}
