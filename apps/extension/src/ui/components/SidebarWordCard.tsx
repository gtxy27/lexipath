import React, { useCallback, useState } from "react";
import { createLogger, getErrorMessage } from "@lexipath/core/log";
import { speak, stop } from "@lexipath/dictionary";
import { Card, CardContent, CardFooter, CardHeader } from "./ui/card"; 
import { Button } from "./ui/button"; 
import { Badge } from "./ui/badge"; 
import { Volume2, Star, Check, X, Sparkles, ChevronDown } from "lucide-react"; 
import { cn } from "../lib/utils"; 
import { motion, AnimatePresence } from "framer-motion"; 
import { t } from "../../shared/i18n"; 

const log = createLogger("ui:WordCard");

export interface WordCardData {
  word: string;
  phonetic?: string;
  definition: string;
  difficulty?: string;
  targets?: string[];
  isFavorited?: boolean;
  isLearned?: boolean;
}

export interface WordCardProps {
  data: WordCardData;
  mode?: "hover" | "click";
  ttsLang?: string;
  wordbookState?: "active" | "archived" | "ignored" | null;
  onWordbookToggle?: (
    word: string,
    currentState: "active" | "archived" | "ignored" | null,
  ) => void;
  onFavoriteToggle?: (word: string, isFavorited: boolean) => void;
  onLearnedToggle?: (word: string, isLearned: boolean) => void;
  onClose?: () => void;
}

export function WordCard({
  data,
  mode = "click",
  ttsLang,
  wordbookState = null,
  onWordbookToggle,
  onFavoriteToggle,
  onLearnedToggle,
  onClose,
}: WordCardProps): React.ReactElement {
  const [isFavorited, setIsFavorited] = useState(data.isFavorited ?? false);
  const [isLearned, setIsLearned] = useState(data.isLearned ?? false);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isTargetsExpanded, setIsTargetsExpanded] = useState(false);

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
      log.error("TTS error", { message: getErrorMessage(error) });
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

  const handleWordbookToggle = useCallback(() => { 
    onWordbookToggle?.(data.word, wordbookState); 
  }, [data.word, onWordbookToggle, wordbookState]); 
 
  const getDifficultyStyles = (difficulty?: string) => { 
    if (!difficulty) return "text-muted-foreground border-border bg-muted/20"; 
    const lower = difficulty.toLowerCase(); 
    if (lower.includes("easy") || lower === "a1" || lower === "a2") {
      return "text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10";
    }
    if (lower.includes("medium") || lower === "b1" || lower === "b2") {
      return "text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10";
    }
    if (lower.includes("hard") || lower === "c1" || lower === "c2") {
      return "text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-500/10";
    }
    return "text-primary border-primary/25 bg-primary/10";
  };

  const getWordbookStateLabel = (
    state: "active" | "archived" | "ignored",
  ): string => {
    switch (state) {
      case "active":
        return t("wordCard_stateActive");
      case "archived":
        return t("wordCard_stateArchived");
      case "ignored":
        return t("wordCard_stateIgnored");
    }
  };

  const getWordbookStateStyles = (
    state: "active" | "archived" | "ignored",
  ): string => {
    switch (state) {
      case "active":
        return "text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-500/20 bg-emerald-50 dark:bg-emerald-500/10";
      case "archived":
        return "text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-500/20 bg-amber-50 dark:bg-amber-500/10";
      case "ignored":
        return "text-muted-foreground border-border bg-muted/20";
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="relative p-[1px] rounded-2xl bg-gradient-to-b from-border/70 to-transparent shadow-xl"
    >
      <Card className="w-full min-w-[300px] max-w-[400px] border-0 bg-card overflow-hidden rounded-[15px] transition-all duration-500">
        <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-3 pt-6 px-6 relative">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <h3 className="text-2xl font-black tracking-tight text-foreground">
                {data.word}
              </h3>
              {wordbookState && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[9px] px-1.5 py-0 h-4.5 font-bold uppercase tracking-wider border shadow-none",
                    getWordbookStateStyles(wordbookState),
                  )}
                >
                  {getWordbookStateLabel(wordbookState)}
                </Badge>
              )}
              {data.difficulty && (
                <Badge
                  variant="outline"
                  className={cn(
                    "text-[9px] px-1.5 py-0 h-4.5 font-bold uppercase tracking-wider border shadow-none",
                    getDifficultyStyles(data.difficulty),
                  )}
                > 
                  {data.difficulty} 
                </Badge> 
              )} 
            </div> 
            {data.phonetic && ( 
              <div className="flex items-center gap-1.5"> 
                 <Sparkles className="h-3 w-3 text-primary/70" /> 
                 <p className="text-xs text-muted-foreground font-medium tracking-wide">
                  {data.phonetic}
                 </p>
              </div>
            )}
          </div>

          {mode === "click" && onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 -mr-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl transition-colors"
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
          <div className="p-4 rounded-xl bg-muted/20 border border-border transition-colors">
             <p className="text-[13px] leading-relaxed text-foreground/90 font-semibold">
               {data.definition}
             </p>
          </div>

          {data.targets && data.targets.length > 0 && (
            <div className="mt-4">
               <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1 mb-2">
                 {t("wordCard_sectionTranslation") || "Translations"}
               </h4>
               
               <div className="flex flex-col gap-2">
                  <div className="p-3 rounded-lg bg-muted/10 border border-border/50">
                    <p className="text-sm font-semibold text-foreground">{data.targets[0]}</p>
                  </div>

                  {data.targets.length > 1 && (
                    <div className="flex flex-col">
                       <AnimatePresence>
                         {isTargetsExpanded && (
                           <motion.div
                             initial={{ height: 0, opacity: 0 }}
                             animate={{ height: "auto", opacity: 1 }}
                             exit={{ height: 0, opacity: 0 }}
                             className="overflow-hidden"
                             data-testid="word-card-translations-expanded"
                           >
                             <div className="flex flex-col gap-2 pt-1 pb-2">
                               {data.targets.slice(1).map((target, i) => (
                                 <div key={i} className="p-2.5 rounded-md bg-muted/5 border border-transparent hover:bg-muted/10 hover:border-border/30 transition-colors">
                                   <p className="text-[13px] text-muted-foreground">{target}</p>
                                 </div>
                               ))}
                             </div>
                           </motion.div>
                         )}
                       </AnimatePresence>
                       
                       <Button
                         variant="ghost"
                         size="sm"
                         onClick={() => setIsTargetsExpanded(!isTargetsExpanded)}
                         className="h-7 self-start px-2 text-muted-foreground hover:text-foreground text-[11px] flex items-center gap-1.5 hover:bg-muted/20 -ml-1 mt-1"
                         aria-expanded={isTargetsExpanded}
                         data-testid="word-card-translations-toggle"
                       >
                         <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", isTargetsExpanded && "rotate-180")} />
                         {isTargetsExpanded ? (t("wordCard_showLess") || "Show less") : (t("wordCard_showMore") || "Show more")}
                       </Button>
                    </div>
                  )}
               </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex items-center justify-between p-4 px-6 bg-muted/10 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSpeak}
            disabled={isPlayingAudio}
            className="h-9 gap-2 px-3 text-primary hover:text-primary/90 hover:bg-primary/10 rounded-xl transition-all font-bold"
            aria-label={t("wordCard_pronounce")}
          >
            <motion.div animate={isPlayingAudio ? { scale: [1, 1.15, 1] } : {}} transition={{ repeat: Infinity }}>
              <Volume2 className={cn("h-4 w-4", isPlayingAudio && "text-primary")} />
            </motion.div>
            <span className="text-[10px] font-bold uppercase tracking-widest">
              {t("wordCard_pronounce")}
            </span>
          </Button>

          <div className="flex items-center gap-2"> 
            {onWordbookToggle && ( 
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleWordbookToggle} 
                className={cn( 
                  "h-9 w-9 p-0 rounded-xl transition-all", 
                  wordbookState 
                    ? "text-amber-500 bg-amber-500/10 border border-amber-500/20" 
                    : "text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 border border-transparent", 
                )} 
                aria-label={wordbookState ? t("wordCard_unsave") : t("wordCard_save")} 
              > 
                <Star className={cn("h-4 w-4", wordbookState && "fill-current")} /> 
              </Button> 
            )} 
 
            {!onWordbookToggle && ( 
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={handleFavoriteToggle} 
                className={cn( 
                  "h-9 w-9 p-0 rounded-xl transition-all", 
                  isFavorited 
                    ? "text-amber-500 bg-amber-500/10 border border-amber-500/20" 
                    : "text-muted-foreground hover:text-amber-500 hover:bg-amber-500/10 border border-transparent", 
                )} 
                aria-label={t("wordCard_favorite")} 
              > 
                <Star className={cn("h-4 w-4", isFavorited && "fill-current")} /> 
              </Button> 
            )} 
 
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={handleLearnedToggle}
              className={cn(
                "h-9 gap-2 px-3 rounded-xl transition-all border font-bold",
                isLearned
                  ? "text-emerald-600 bg-emerald-500/10 border-emerald-500/20"
                  : "text-muted-foreground hover:text-emerald-600 hover:bg-emerald-500/10 border-transparent",
              )}
              aria-label={t("wordCard_markLearned")}
            >
              <Check className={cn("h-4 w-4", isLearned && "text-emerald-500")} />
              <span className="text-[10px] font-bold uppercase tracking-widest">
                {t("wordCard_markLearned")}
              </span>
            </Button>
          </div>
        </CardFooter>
      </Card>
    </motion.div>
  );
}
