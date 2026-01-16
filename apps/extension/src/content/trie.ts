/**
 * Trie data structure for efficient multi-pattern matching.
 * Used for word highlighting in enhanced text.
 */

export interface TrieNode<TWordData = unknown> {
  children: Map<string, TrieNode<TWordData>>;
  isEndOfWord: boolean;
  wordData?: TWordData; // Store associated word metadata
}

export class Trie<TWordData = unknown> {
  private root: TrieNode<TWordData>;

  constructor() {
    this.root = {
      children: new Map(),
      isEndOfWord: false,
    };
  }

  /**
   * Insert a word into the trie with optional metadata.
   */
  insert(word: string, wordData?: TWordData): void {
    if (!word) return;

    let node = this.root;
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      if (!char) continue;

      if (!node.children.has(char)) {
        node.children.set(char, {
          children: new Map(),
          isEndOfWord: false,
        });
      }
      node = node.children.get(char)!;
    }

    node.isEndOfWord = true;
    if (wordData !== undefined) {
      node.wordData = wordData;
    }
  }

  /**
   * Find all matches starting at a given position in the text.
   * Returns an array of {length, wordData} for all matching words.
   */
  findMatchesAt(text: string, startPos: number): Array<{ length: number; wordData: TWordData | undefined }> {
    const matches: Array<{ length: number; wordData: TWordData | undefined }> = [];
    let node = this.root;
    let pos = startPos;

    while (pos < text.length) {
      const char = text[pos];
      if (!char) break;

      const next = node.children.get(char);
      if (!next) break;

      node = next;
      pos++;

      if (node.isEndOfWord) {
        matches.push({
          length: pos - startPos,
          wordData: node.wordData,
        });
      }
    }

    return matches;
  }

  /**
   * Search for a complete word in the trie.
   */
  search(word: string): { found: boolean; wordData: TWordData | undefined } {
    if (!word) return { found: false, wordData: undefined };

    let node = this.root;
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      if (!char) return { found: false, wordData: undefined };

      const next = node.children.get(char);
      if (!next) return { found: false, wordData: undefined };
      node = next;
    }

    return {
      found: node.isEndOfWord,
      wordData: node.wordData,
    };
  }
}
