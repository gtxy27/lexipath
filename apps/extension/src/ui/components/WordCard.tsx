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
  
  // Custom difficulty colors to match original design intent better than standard variants
  const getDifficultyClass = (difficulty?: string) => {
      if (!difficulty) return "bg-muted text-muted-foreground hover:bg-muted/80";
      const lower = difficulty.toLowerCase();
      if (lower.includes('easy') || lower === 'a1' || lower === 'a2') {
        return "bg-green-100 text-green-700 hover:bg-green-200 border-transparent";
      }
      if (lower.includes('medium') || lower === 'b1' || lower === 'b2') {
        return "bg-yellow-100 text-yellow-700 hover:bg-yellow-200 border-transparent";
      }
      if (lower.includes('hard') || lower === 'c1' || lower === 'c2') {
        return "bg-red-100 text-red-700 hover:bg-red-200 border-transparent";
      }
      return "bg-muted text-muted-foreground hover:bg-muted/80";
  }

  return (
    <Card className="w-full min-w-[280px] max-w-[400px] shadow-lg border-0">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2 pt-4 px-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold leading-none">{data.word}</h3>
            {data.difficulty && (
              <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 h-5", getDifficultyClass(data.difficulty))}>
                {data.difficulty}
              </Badge>
            )}
          </div>
          {data.phonetic && (
            <p className="text-sm text-muted-foreground font-mono">{data.phonetic}</p>
          )}
        </div>
        
        {mode === 'click' && onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground"
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

      <CardContent className="pb-3 px-4">
        <p className="text-sm leading-relaxed text-foreground">
          {data.definition}
        </p>
      </CardContent>
      
      <Separator />

      <CardFooter className="flex items-center justify-between p-2 px-4 bg-muted/20">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSpeak}
          disabled={isPlayingAudio}
          className="h-8 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
          aria-label={browser.i18n.getMessage('wordCard_pronounce')}
        >
          <Volume2 className={cn("h-4 w-4", isPlayingAudio && "animate-pulse text-primary")} />
          <span className="text-xs font-medium">{browser.i18n.getMessage('wordCard_pronounce')}</span>
        </Button>

        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFavoriteToggle}
            className={cn(
              "h-8 w-8 p-0",
              isFavorited ? "text-yellow-500 hover:text-yellow-600 hover:bg-yellow-50" : "text-muted-foreground hover:text-foreground"
            )}
            aria-label={browser.i18n.getMessage('wordCard_favorite')}
          >
            <Star className={cn("h-4 w-4", isFavorited && "fill-current")} />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLearnedToggle}
            className={cn(
              "h-8 gap-1.5 px-2",
               isLearned 
                ? "text-green-600 hover:text-green-700 hover:bg-green-50" 
                : "text-muted-foreground hover:text-foreground"
            )}
            aria-label={browser.i18n.getMessage('wordCard_markLearned')}
          >
             <Check className="h-4 w-4" />
             <span className="text-xs font-medium">{browser.i18n.getMessage('wordCard_markLearned')}</span>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
