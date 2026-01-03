import React, { useCallback, useState } from 'react';
import browser from 'webextension-polyfill';
import { speak, stop } from '@lexipath/dictionary';
import { Card, CardContent, CardFooter, CardHeader } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Separator } from './ui/separator';
import { Volume2, Star, Check, X } from 'lucide-react';
import { cn } from '../lib/utils';

export interface WordCardData {
  word: string;
  phonetic?: string;
  definition: string;
  difficulty?: string;
  isFavorited?: boolean;
  isLearned?: boolean;
}

export interface WordCardProps {
  data: WordCardData;
  mode?: 'hover' | 'click';
  ttsLang?: string;
  onFavoriteToggle?: (word: string, isFavorited: boolean) => void;
  onLearnedToggle?: (word: string, isLearned: boolean) => void;
  onClose?: () => void;
}

export function WordCard({
  data,
  mode = 'click',
  ttsLang,
  onFavoriteToggle,
  onLearnedToggle,
  onClose,
}: WordCardProps): React.ReactElement {
  const [isFavorited, setIsFavorited] = useState(data.isFavorited ?? false);
  const [isLearned, setIsLearned] = useState(data.isLearned ?? false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);

  const handleSpeak = useCallback(async () => {
    if (isPlayingAudio) {
      stop();
      setIsPlayingAudio(false);
      return;
    }

    try {
      setIsPlayingAudio(true);
      await speak(data.word, ttsLang ?? 'en-US');
    } catch (error) {
      console.error('[WordCard] TTS error:', error);
    } finally {
      setIsPlayingAudio(false);
    }
  }, [data.word, isPlayingAudio, ttsLang]);

  const handleFavoriteToggle = useCallback(() => {
    const nextValue = !isFavorited;
    setIsFavorited(nextValue);
    onFavoriteToggle?.(data.word, nextValue);
  }, [data.word, isFavorited, onFavoriteToggle]);

  const handleLearnedToggle = useCallback(() => {
    const nextValue = !isLearned;
    setIsLearned(nextValue);
    onLearnedToggle?.(data.word, nextValue);
  }, [data.word, isLearned, onLearnedToggle]);

  const getDifficultyBadgeVariant = (difficulty?: string) => {
    if (!difficulty) return "secondary";
    const lower = difficulty.toLowerCase();
    if (lower.includes('easy') || lower === 'a1' || lower === 'a2') {
      return "default"; // Greenish usually, but default is primary. We might need custom styles.
    }
    if (lower.includes('medium') || lower === 'b1' || lower === 'b2') {
      return "secondary";
    }
    if (lower.includes('hard') || lower === 'c1' || lower === 'c2') {
      return "destructive";
    }
    return "outline";
  };
  
  const getDifficultyClass = (difficulty?: string) => {
      if (!difficulty) return "bg-muted text-muted-foreground hover:bg-muted/80";
      const lower = difficulty.toLowerCase();
      if (lower.includes('easy') || lower === 'a1' || lower === 'a2') {
        return "bg-gradient-to-br from-green-400 to-emerald-500 text-white border-0 shadow-sm";
      }
      if (lower.includes('medium') || lower === 'b1' || lower === 'b2') {
        return "bg-gradient-to-br from-yellow-400 to-orange-500 text-white border-0 shadow-sm";
      }
      if (lower.includes('hard') || lower === 'c1' || lower === 'c2') {
        return "bg-gradient-to-br from-red-400 to-rose-600 text-white border-0 shadow-sm";
      }
      return "bg-muted text-muted-foreground hover:bg-muted/80";
  }

  return (
    <Card className="w-full min-w-[280px] max-w-[400px] shadow-2xl border-0 overflow-hidden bg-gradient-to-br from-card via-card to-card/90 backdrop-blur-sm">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent pointer-events-none"></div>

      <CardHeader className="relative flex flex-row items-start justify-between space-y-0 pb-3 pt-5 px-5 border-b border-border/50 bg-gradient-to-br from-muted/30 to-transparent">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <h3 className="text-2xl font-bold leading-none bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text">{data.word}</h3>
            {data.difficulty && (
              <Badge variant="outline" className={cn("text-[10px] px-2 py-0.5 h-5 font-semibold", getDifficultyClass(data.difficulty))}>
                {data.difficulty}
              </Badge>
            )}
          </div>
          {data.phonetic && (
            <p className="text-sm text-muted-foreground/80 font-mono italic">{data.phonetic}</p>
          )}
        </div>

        {mode === 'click' && onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all duration-200 rounded-lg"
            onClick={() => {
              stop();
              onClose();
            }}
            aria-label={browser.i18n.getMessage('wordCard_close')}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>

      <CardContent className="relative pb-4 pt-4 px-5 bg-gradient-to-b from-transparent to-muted/10">
        <p className="text-sm leading-relaxed text-foreground/90">
          {data.definition}
        </p>
      </CardContent>

      <Separator className="bg-border/50" />

      <CardFooter className="relative flex items-center justify-between p-3 px-5 bg-gradient-to-br from-muted/20 to-muted/10 backdrop-blur-sm">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSpeak}
          disabled={isPlayingAudio}
          className="h-9 gap-2 px-3 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-200 rounded-lg group"
          aria-label={browser.i18n.getMessage('wordCard_pronounce')}
        >
          <Volume2 className={cn("h-4 w-4 transition-all duration-200", isPlayingAudio ? "animate-pulse text-primary scale-110" : "group-hover:scale-110")} />
          <span className="text-xs font-medium">{browser.i18n.getMessage('wordCard_pronounce')}</span>
        </Button>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFavoriteToggle}
            className={cn(
              "h-9 w-9 p-0 rounded-lg transition-all duration-200",
              isFavorited
                ? "text-yellow-500 hover:text-yellow-600 bg-yellow-500/10 hover:bg-yellow-500/20 shadow-sm"
                : "text-muted-foreground hover:text-yellow-500 hover:bg-yellow-500/10"
            )}
            aria-label={browser.i18n.getMessage('wordCard_favorite')}
          >
            <Star className={cn("h-4 w-4 transition-all duration-200", isFavorited && "fill-current animate-in zoom-in-50")} />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLearnedToggle}
            className={cn(
              "h-9 gap-1.5 px-3 rounded-lg transition-all duration-200",
               isLearned
                ? "text-green-600 hover:text-green-700 bg-green-500/10 hover:bg-green-500/20 shadow-sm"
                : "text-muted-foreground hover:text-green-600 hover:bg-green-500/10"
            )}
            aria-label={browser.i18n.getMessage('wordCard_markLearned')}
          >
             <Check className={cn("h-4 w-4 transition-all duration-200", isLearned && "animate-in zoom-in-50")} />
             <span className="text-xs font-medium">{browser.i18n.getMessage('wordCard_markLearned')}</span>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
