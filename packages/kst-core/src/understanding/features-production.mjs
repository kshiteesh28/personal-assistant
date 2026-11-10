import { interpret } from './interpreter.mjs';
import { maskedUtterance } from './extraction.mjs';
import { extractFeatures } from './features.mjs';

/** Exact classifier input used before model selection by the conversation coordinator. */
export function productionFeatures(utterance,context={},reference={}) {
 const grammar=interpret(utterance,reference);
 const masked=maskedUtterance(utterance,grammar.action);
 return {features:extractFeatures(masked,context),masked,grammar};
}
