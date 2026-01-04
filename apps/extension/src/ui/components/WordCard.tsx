import React, { useCallback, useState } from "react";
import browser from "webextension-polyfill";
import { speak, stop } from "@lexipath/dictionary";
import { Card, CardContent, CardFooter, CardHeader } from "./ui/card";
import { Button } from "./ui/button";
import { Badge } from "./ui/badge";
import { Volume2, Star, Check, X, Sparkles } from "lucide-react";
import { cn } from "../lib/utils";
import { motion, AnimatePresence } from "framer-motion";

function t(key: string): string {
  return browser.i18n.getMessage(key) || key;
}

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

  const getDifficultyStyles = (difficulty?: string) => {
    if (!difficulty) return "text-gray-400 border-white/5 bg-white/5";
    const lower = difficulty.toLowerCase();
    if (lower.includes("easy") || lower === "a1" || lower === "a2") {
      return "text-emerald-400 border-emerald-500/20 bg-emerald-500/10 shadow-[0_0_10px_rgba(16,185,129,0.1)]";
    }
    if (lower.includes("medium") || lower === "b1" || lower === "b2") {
      return "text-amber-400 border-amber-500/20 bg-amber-500/10 shadow-[0_0_10px_rgba(245,158,11,0.1)]";
    }
    if (lower.includes("hard") || lower === "c1" || lower === "c2") {
      return "text-rose-400 border-rose-500/20 bg-rose-500/10 shadow-[0_0_10px_rgba(244,63,94,0.1)]";
    }
    return "text-indigo-400 border-indigo-500/20 bg-indigo-500/10";
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9, y: 10 }}
      className="relative p-[1px] rounded-2xl bg-gradient-to-b from-gray-200 dark:from-white/10 to-transparent shadow-2xl"
    >
      <Card className="w-full min-w-[300px] max-w-[420px] border-0 bg-white dark:bg-[#12131a] overflow-hidden relative rounded-[15px] transition-colors duration-500">
        {/* Glow effect */}
        <div className="absolute top-0 left-1/4 w-1/2 h-1 bg-gradient-premium blur-sm opacity-30 dark:opacity-50" />
        
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3 pt-6 px-6 relative">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <h3 className="text-2xl font-black tracking-tight text-gray-900 dark:text-white">
                {data.word}
              </h3>
              {data.difficulty && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[10px] px-2 py-0 h-5 font-black uppercase tracking-widest border",
                    getDifficultyStyles(data.difficulty),
                  )}
                >
                  {data.difficulty}
                </Badge>
              )}
            </div>
            {data.phonetic && (
              <div className="flex items-center gap-2">
                 <Sparkles className="h-3 w-3 text-indigo-500" />
                 <p className="text-xs text-gray-400 dark:text-gray-500 font-mono font-bold uppercase tracking-wider">
                  {data.phonetic}
                 </p>
              </div>
            )}
          </div>

          {mode === "click" && onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 -mr-1 text-gray-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-white/5 rounded-lg transition-colors"
              onClick={() => {
                stop();
                onClose();
              }}
              aria-label={t("wordCard_close")}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </CardHeader>

        <CardContent className="pb-6 pt-2 px-6">
          <div className="relative p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-100 dark:border-white/5 shadow-inner">
             <p className="text-sm leading-relaxed text-gray-600 dark:text-gray-300 font-bold">
               {data.definition}
             </p>
          </div>
        </CardContent>

        <CardFooter className="flex items-center justify-between p-4 px-6 bg-gray-50/50 dark:bg-[#0d0e14]/50 border-t border-gray-100 dark:border-white/5">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSpeak}
            disabled={isPlayingAudio}
            className="h-10 gap-2.5 px-4 text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-500/10 rounded-xl transition-all font-bold"
            aria-label={t("wordCard_pronounce")}
          >
            <motion.div animate={isPlayingAudio ? { scale: [1, 1.2, 1] } : {}} transition={{ repeat: Infinity }}>
              <Volume2 className={cn("h-4 w-4", isPlayingAudio && "text-indigo-500")} />
            </motion.div>
            <span className="text-[10px] font-black uppercase tracking-widest">
              {t("wordCard_pronounce")}
            </span>
          </Button>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleFavoriteToggle}
              className={cn(
                "h-10 w-10 p-0 rounded-xl transition-all",
                isFavorited
                  ? "text-amber-500 bg-amber-500/10 border border-amber-500/20"
                  : "text-gray-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-white/5 border border-transparent",
              )}
              aria-label={t("wordCard_favorite")}
            >
              <Star className={cn("h-4 w-4", isFavorited && "fill-current")} />
            </Button>

            <Button
              variant="ghost"
              size="sm"
              onClick={handleLearnedToggle}
              className={cn(
                "h-10 gap-2 px-4 rounded-xl transition-all border font-bold",
                isLearned
                  ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/20"
                  : "text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-white/5 border-transparent",
              )}
              aria-label={t("wordCard_markLearned")}
            >
              <Check className={cn("h-4 w-4", isLearned && "text-emerald-500")} />
              <span className="text-[10px] font-black uppercase tracking-widest">
                {t("wordCard_markLearned")}
              </span>
            </Button>
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );
}
