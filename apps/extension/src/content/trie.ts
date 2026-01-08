/**
 * Trie data structure for efficient multi-pattern matching.
 * Used for word highlighting in enhanced text.
 */

export interface TrieNode {
  children: Map<string, TrieNode>;
  isEndOfWord: boolean;
  wordData?: any; // Store associated word metadata
}

export class Trie {
  private root: TrieNode;

  constructor() {
    this.root = {
      children: new Map(),
      isEndOfWord: false,
    };
  }

  /**
   * Insert a word into the trie with optional metadata.
   */
  insert(word: string, wordData?: any): void {
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
  findMatchesAt(text: string, startPos: number): Array<{ length: number; wordData: any }> {
    const matches: Array<{ length: number; wordData: any }> = [];
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
  search(word: string): { found: boolean; wordData?: any } {
    if (!word) return { found: false };

    let node = this.root;
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      if (!char) return { found: false };

      const next = node.children.get(char);
      if (!next) return { found: false };
      node = next;
    }

    return {
      found: node.isEndOfWord,
      wordData: node.wordData,
    };
  }
}
