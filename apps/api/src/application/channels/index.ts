/**
 * @file index.ts
 * @description Barrel export for channel use cases — primary management today;
 *              channel CRUD lives in route handlers and may move here later.
 * @layer application
 */

export {
  SetPrimaryChannelUseCase,
  type SetPrimaryChannelInput,
  type SetPrimaryChannelOutput,
} from "./SetPrimaryChannelUseCase.js";

export {
  UpdateChannelAuthStateUseCase,
  type UpdateChannelAuthStateInput,
  type UpdateChannelAuthStateOutput,
} from "./UpdateChannelAuthStateUseCase.js";
