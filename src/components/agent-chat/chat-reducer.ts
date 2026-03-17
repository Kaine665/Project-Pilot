import type { ChatMessage, ContentBlock } from '@/types';

export type ChatState = {
  messages: ChatMessage[];
  isStreaming: boolean;
  streamingBlocks: ContentBlock[];
  errorMsg: string | null;
  inPlanMode: boolean;
  tokenInputs: number;
  tokenOutputs: number;
};

export type ChatAction =
  | { type: 'SEND_START' }
  | { type: 'STREAM_BLOCKS'; blocks: ContentBlock[] }
  | { type: 'STREAM_TOKENS'; input: number; output: number; final?: boolean }
  | { type: 'STREAM_ERROR'; message: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'STREAM_END' }
  | { type: 'PLAN_STARTED' }
  | { type: 'PLAN_FINISHED' }
  | { type: 'APPEND_MESSAGE'; message: ChatMessage }
  | { type: 'SET_MESSAGES'; messages: ChatMessage[] }
  | { type: 'UPDATE_MESSAGES'; updater: (prev: ChatMessage[]) => ChatMessage[] }
  | { type: 'RESET' };

export const chatInitialState: ChatState = {
  messages: [],
  isStreaming: false,
  streamingBlocks: [],
  errorMsg: null,
  inPlanMode: false,
  tokenInputs: 0,
  tokenOutputs: 0,
};

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'SEND_START':
      return { ...state, isStreaming: true, streamingBlocks: [], errorMsg: null };
    case 'STREAM_BLOCKS':
      return { ...state, streamingBlocks: action.blocks };
    case 'STREAM_TOKENS':
      // final = true: from result event, cumulative total — replace directly
      // final = false/undefined: from streaming incremental event
      //   - input: overwrite (each message_start input_tokens includes full history)
      //   - output: accumulate (each message_delta only reports current turn's output_tokens)
      if (action.final) {
        return {
          ...state,
          tokenInputs: action.input > 0 ? action.input : state.tokenInputs,
          tokenOutputs: action.output > 0 ? action.output : state.tokenOutputs,
        };
      }
      return {
        ...state,
        tokenInputs: action.input > 0 ? action.input : state.tokenInputs,
        tokenOutputs: action.output > 0 ? state.tokenOutputs + action.output : state.tokenOutputs,
      };
    case 'STREAM_ERROR':
      return { ...state, errorMsg: action.message };
    case 'CLEAR_ERROR':
      return { ...state, errorMsg: null };
    case 'STREAM_END':
      return { ...state, isStreaming: false, streamingBlocks: [], inPlanMode: false };
    case 'PLAN_STARTED':
      return { ...state, inPlanMode: true };
    case 'PLAN_FINISHED':
      return { ...state, inPlanMode: false };
    case 'APPEND_MESSAGE':
      return { ...state, messages: [...state.messages, action.message] };
    case 'SET_MESSAGES':
      return { ...state, messages: action.messages };
    case 'UPDATE_MESSAGES':
      return { ...state, messages: action.updater(state.messages) };
    case 'RESET':
      return { ...chatInitialState };
    default:
      return state;
  }
}
