import React, { useCallback, useState } from "react";
import browser from "webextension-polyfill";
import { speak, stop } from "@lexipath/dictionary";
import { Card, CardContent, CardFooter, CardHeader } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Separator } from "./ui/separator";
import { Volume2, Star, Check, X } from "lucide-react";
import { cn } from "../lib/utils";

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
  mode?: "hover" | "click";
  ttsLang?: string;
  onFavoriteToggle?: (word: string, isFavorited: boolean) => void;
  onLearnedToggle?: (word: string, isLearned: boolean) => void;
  onClose?: () => void;
}

export function WordCard({
  data,
  mode = "click",
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
      await speak(data.word, ttsLang ?? "en-US");
    } catch (error) {
      console.error("[WordCard] TTS error:", error);
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
    if (lower.includes("easy") || lower === "a1" || lower === "a2") {
      return "default"; // Greenish usually, but default is primary. We might need custom styles.
    }
    if (lower.includes("medium") || lower === "b1" || lower === "b2") {
      return "secondary";
    }
    if (lower.includes("hard") || lower === "c1" || lower === "c2") {
      return "destructive";
    }
    return "outline";
  };

  const getDifficultyClass = (difficulty?: string) => {
    if (!difficulty) return "bg-gray-200 text-gray-600";
    const lower = difficulty.toLowerCase();
    if (lower.includes("easy") || lower === "a1" || lower === "a2") {
      return "bg-emerald-500 text-white";
    }
    if (lower.includes("medium") || lower === "b1" || lower === "b2") {
      return "bg-amber-500 text-white";
    }
    if (lower.includes("hard") || lower === "c1" || lower === "c2") {
      return "bg-rose-500 text-white";
    }
    return "bg-gray-200 text-gray-600";
  };

  return (
    <Card className="w-full min-w-[280px] max-w-[400px] shadow-lg border-gray-200 overflow-hidden bg-white relative">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3 pt-5 px-5 border-b border-gray-200 bg-white">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2.5">
            <h3 className="text-2xl font-bold leading-none text-gray-900">
              {data.word}
            </h3>
            {data.difficulty && (
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] px-2 py-0.5 h-5 font-semibold border-0",
                  getDifficultyClass(data.difficulty),
                )}
              >
                {data.difficulty}
              </Badge>
            )}
          </div>
          {data.phonetic && (
            <p className="text-sm text-gray-500 font-mono italic">
              {data.phonetic}
            </p>
          )}
        </div>

        {mode === "click" && onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 -mr-2 -mt-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg"
            onClick={() => {
              stop();
              onClose();
            }}
            aria-label={browser.i18n.getMessage("wordCard_close")}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>

      <CardContent className="pb-4 pt-4 px-5">
        <p className="text-sm leading-relaxed text-gray-700">
          {data.definition}
        </p>
      </CardContent>

      <Separator className="bg-gray-200" />

      <CardFooter className="flex items-center justify-between p-3 px-5 bg-gray-50">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleSpeak}
          disabled={isPlayingAudio}
          className="h-9 gap-2 px-3 text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg"
          aria-label={browser.i18n.getMessage("wordCard_pronounce")}
        >
          <Volume2
            className={cn(
              "h-4 w-4",
              isPlayingAudio && "animate-pulse text-indigo-600",
            )}
          />
          <span className="text-xs font-medium">
            {browser.i18n.getMessage("wordCard_pronounce")}
          </span>
        </Button>

        <div className="flex items-center gap-1.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFavoriteToggle}
            className={cn(
              "h-9 w-9 p-0 rounded-lg",
              isFavorited
                ? "text-yellow-600 hover:text-yellow-700 bg-yellow-50 hover:bg-yellow-100"
                : "text-gray-400 hover:text-yellow-600 hover:bg-yellow-50",
            )}
            aria-label={browser.i18n.getMessage("wordCard_favorite")}
          >
            <Star className={cn("h-4 w-4", isFavorited && "fill-current")} />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleLearnedToggle}
            className={cn(
              "h-9 gap-1.5 px-3 rounded-lg",
              isLearned
                ? "text-emerald-600 hover:text-emerald-700 bg-emerald-50 hover:bg-emerald-100"
                : "text-gray-400 hover:text-emerald-600 hover:bg-emerald-50",
            )}
            aria-label={browser.i18n.getMessage("wordCard_markLearned")}
          >
            <Check className={cn("h-4 w-4", isLearned && "fill-current")} />
            <span className="text-xs font-medium">
              {browser.i18n.getMessage("wordCard_markLearned")}
            </span>
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}
