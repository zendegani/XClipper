import type { ExtractedContent } from '../types/messages';
import { domToAst } from './dom-to-ast';
import { docToExtracted } from '../shared/extracted-content';

export function extractArticle(): ExtractedContent {
  return docToExtracted(domToAst());
}
