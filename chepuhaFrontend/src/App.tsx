import { useState, useEffect, useCallback, useRef } from "react";
import Button from "./components/Button/Button";
import HistoryScreen from "./components/HistoryScreen/HistoryScreen";
import { RoundCard } from "./components/RoundCard/RoundCard";
import GameCode from "./components/GameCode/GameCode";
import "./App.scss";
import { Phases } from "./types/phaseVariant";
import Round from "./components/Round/Round";
import Timer from "./components/Timer/Timer";
import JoinCard from "./components/JoinCard/JoinCard";
import WaitCard from "./components/WaitCard/WaitCard";
import GameResult from "./components/GameResult/GameResult";
import logoImage from "./assets/images/Logo.png";
import homeImage from "./assets/images/house.png";
import crownImage from "./assets/images/Crown.png";
import flagUk from "./assets/images/flag_uk.png";
import flagEn from "./assets/images/flag_en.png";
import { useHistory, SavedGame } from "./hooks/useHistory";
import { playSecretMusic } from "./utils/audio";

const STATE_STORAGE_KEY = "chepuhaActiveGameState";

import { useGameState } from "./hooks/useGameState";
import {
  createGameSession,
  createPlayer,
  updateGameSession,
  createRound,
  createStorySheet,
  submitAnswer,
  getAnswersByRound,
  QuestionType,
  getGameSessions,
  getStorySheetsBySession,
  getRoundsBySession,
} from "./api";

import { TEMPLATES } from "./config/templates";
import { useLanguage } from "./contexts/LanguageContext";

const HomeIcon = ({ onClick, className }: { onClick: () => void, className?: string }) => (
  <div className={className} onClick={onClick}>
    <img
      src={homeImage}
      alt="Home"
    />
  </div>
);

function App() {
  const [phase, setPhase] = useState<Phases>(Phases.Main);
  const [didGameStart, setDidGameStart] = useState(false);
  const [currentRound, setCurrentRound] = useState(1);
  const [userAnswers, setUserAnswers] = useState<string[]>([]);

  const [isCreatingLobby, setIsCreatingLobby] = useState(false);
  const [isLobby, setIsLobby] = useState(false);

  const [nickname, setNickname] = useState("");
  const [roomCode, setRoomCode] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("classic");
  const [error, setError] = useState("");
  const [allStories, setAllStories] = useState<{ playerName: string; story: string; answers?: string[]; templateId?: string }[]>([]);
  const [storyIndex, setStoryIndex] = useState(0);

  const transitionLockRef = useRef(false);

  const { savedGames, saveGameToHistory } = useHistory();
  const [selectedHistoryGame, setSelectedHistoryGame] = useState<SavedGame | null>(null);

  const [joinedCount, setJoinedCount] = useState(1);
  const [totalCount, setTotalCount] = useState(4);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [currentRoundDocId, setCurrentRoundDocId] = useState<string | null>(null);
  const [myStorySheetId, setMyStorySheetId] = useState<string | null>(null);
  const [playerCount, setPlayerCount] = useState(0);
  const [roundStartedAt, setRoundStartedAt] = useState<string | null>(null);
  const [allStorySheets, setAllStorySheets] = useState<{ playerId: string, sheetId: string }[]>([]);

  const { session, players, error: pollError, refreshState } = useGameState(sessionId);
  const activeTemplate = TEMPLATES[session?.template || selectedTemplate] || TEMPLATES.classic;
  const { t, language, setLanguage } = useLanguage();

  useEffect(() => {
    if (sessionId && playerId && nickname) {
      localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify({
        sessionId,
        playerId,
        nickname,
        roomCode,
        isHost,
        selectedTemplate,
        timestamp: Date.now()
      }));
    } else {
      localStorage.removeItem(STATE_STORAGE_KEY);
    }
  }, [sessionId, playerId, nickname, roomCode, isHost, selectedTemplate]);

  useEffect(() => {
    const saved = localStorage.getItem(STATE_STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Date.now() - parsed.timestamp < 24 * 60 * 60 * 1000) {
          setSessionId(parsed.sessionId);
          setPlayerId(parsed.playerId);
          setNickname(parsed.nickname);
          setRoomCode(parsed.roomCode);
          setIsHost(parsed.isHost);
          setSelectedTemplate(parsed.selectedTemplate || "classic");
          setIsLobby(true);
        } else {
          localStorage.removeItem(STATE_STORAGE_KEY);
        }
      } catch (err) { }
    }
  }, []);

  const fetchFinalStoryResult = useCallback(async () => {
    if (!sessionId) return;
    try {
      const sheets = await getStorySheetsBySession(sessionId);
      const built = sheets
        .filter(s => s.answers && s.answers.length > 0)
        .map(s => {
          const sorted = [...s.answers!].sort((a, b) => a.position_in_sheet - b.position_in_sheet);
          return {
            playerName: s.player?.nickname || 'Гравець',
            story: activeTemplate.buildStory(sorted.map(a => a.answer_text), language),
            answers: sorted.map(a => a.answer_text),
            templateId: activeTemplate.id
          };
        });
      if (built.length > 0) {
        setAllStories(built);
        const hostPlayer = players.find(p => p.player_order === 1) || players[0];
        const hostName = hostPlayer ? hostPlayer.nickname : 'Невідомо';
        const date = new Date().toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
        const gameRoomCode = session?.session_name || roomCode || 'Невідомо';

        saveGameToHistory({
          sessionId: sessionId,
          date,
          roomCode: gameRoomCode,
          hostName,
          stories: built
        });
      }
    } catch (err) { }
  }, [sessionId, players, session, roomCode, language, activeTemplate]);

  useEffect(() => {
    if (!session || !sessionId) return;

    if (session.session_status === 'active' && isLobby && !didGameStart) {
      setDidGameStart(true);
      setIsLobby(false);
      setPhase(Phases.Main);
    }

    if (session.session_status === 'completed' && phase !== Phases.End && phase !== Phases.Main && phase !== Phases.History) {
      fetchFinalStoryResult();
      setPhase(Phases.End);
    }
  }, [session?.session_status, isLobby, didGameStart, isHost, phase, fetchFinalStoryResult, sessionId]);

  useEffect(() => {
    if (!session || session.session_status !== 'active' || isHost || !sessionId || !playerId) return;
    if (myStorySheetId && currentRoundDocId) return;

    (async () => {
      try {
        const [rounds, sheets] = await Promise.all([
          getRoundsBySession(sessionId),
          getStorySheetsBySession(sessionId),
        ]);
        const activeRound = [...rounds].sort((a: any, b: any) => b.round_number - a.round_number)[0];
        if (activeRound && !currentRoundDocId) {
          setCurrentRoundDocId(activeRound.documentId);
          setCurrentRound(activeRound.round_number);
          if (activeRound.started_at) setRoundStartedAt(activeRound.started_at);
        }
        if (sheets.length > 0) {
          setAllStorySheets(sheets.map((s: any) => ({ playerId: s.player?.documentId, sheetId: s.documentId })));
        }
        const mySheet = sheets.find((s: any) => s.player?.documentId === playerId);
        if (mySheet && !myStorySheetId) setMyStorySheetId(mySheet.documentId);
        if (players.length > 0) setPlayerCount(players.length);
      } catch (err) {

      }
    })();
  }, [session?.session_status, isHost, sessionId, playerId, myStorySheetId, currentRoundDocId]);

  useEffect(() => {
    if (phase !== Phases.Waiting || !session || !currentRoundDocId || !sessionId) return;

    let localPhase: Phases = phase;

    const interval = setInterval(async () => {
      if (localPhase !== Phases.Waiting || transitionLockRef.current) return;
      try {
        const ans = await getAnswersByRound(currentRoundDocId);
        setJoinedCount(ans.length);
        const total = playerCount > 0 ? playerCount : players.length;
        setTotalCount(total);

        if (ans.length >= total && total > 0) {
          transitionLockRef.current = true;
          if (currentRound < activeTemplate.questions.length) {
            localPhase = Phases.Main;
            if (isHost) {
              const ts = new Date().toISOString();
              const nextRound = await createRound({
                round_id: `round_${crypto.randomUUID()}`,
                session_id: sessionId,
                round_number: currentRound + 1,
                question_type: activeTemplate.questionTypes[currentRound],
                rounds_status: 'active',
                started_at: ts,
              });
              setCurrentRoundDocId(nextRound.documentId);
              setRoundStartedAt(ts);
              setCurrentRound(prev => prev + 1);
              transitionLockRef.current = false;
              setPhase(Phases.Main);
            } else {
              const rList = await getRoundsBySession(session.documentId!);
              const nextRound = rList.find((r: any) => r.round_number === currentRound + 1);
              if (nextRound) {
                setCurrentRoundDocId(nextRound.documentId);
                if (nextRound.started_at) setRoundStartedAt(nextRound.started_at);
                setCurrentRound(prev => prev + 1);
                transitionLockRef.current = false;
                setPhase(Phases.Main);
              } else {
                localPhase = Phases.Waiting;
                transitionLockRef.current = false;
              }
            }
          } else {
            localPhase = Phases.End;
            if (isHost) {
              await updateGameSession(sessionId, { session_status: 'completed' });
            }
            fetchFinalStoryResult();
            setTimeout(() => {
              transitionLockRef.current = false;
              setPhase(Phases.End);
            }, 1000);
          }
        }
      } catch (err) {

      }
    }, 400);

    return () => clearInterval(interval);
  }, [phase, session?.documentId, currentRoundDocId, playerCount, players.length, currentRound, isHost, sessionId, fetchFinalStoryResult]);

  const generateRoomCode = () => {
    const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 8; i++) {
      code += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return code;
  };

  const goHome = () => {
    setPhase(Phases.Main);
    setDidGameStart(false);
    setIsCreatingLobby(false);
    setIsLobby(false);
    setNickname("");
    setRoomCode("");
    setError("");
    setCurrentRound(1);
    setUserAnswers([]);
    setSessionId(null);
    setPlayerId(null);
    setIsHost(false);
    setCurrentRoundDocId(null);
    setMyStorySheetId(null);
    setSelectedHistoryGame(null);
    localStorage.removeItem(STATE_STORAGE_KEY);
  };

  const doShowCreateScreen = () => {
    setRoomCode(generateRoomCode());
    setIsCreatingLobby(true);
    setIsLobby(false);
  };

  const handleNicknameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value.length <= 10) {
      setNickname(value);
      setError("");
    }
  };

  const goToLobby = async () => {
    if (!nickname.trim()) {
      setError("Введіть нікнейм");
      return;
    }
    try {
      const uniqueSesId = `ses_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const newSession = await createGameSession({
        session_id: uniqueSesId,
        session_name: roomCode,
        max_players: 4,
        session_status: 'waiting',
        template: selectedTemplate,
      });
      setSessionId(newSession.documentId);

      const uniqueHostId = `host_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const hostPlayer = await createPlayer({
        player_id: uniqueHostId,
        nickname,
        session_id: newSession.documentId,
        players_status: 'joined',
        player_order: 1,
      });
      setPlayerId(hostPlayer.documentId);
      setIsHost(true);

      setIsLobby(true);
      await refreshState();
    } catch (err: any) {
      setError("Помилка створення кімнати: " + err.message);
    }
  };

  const doShowJoinScreen = () => {
    setPhase(Phases.Join);
    setDidGameStart(false);
    setIsCreatingLobby(false);
  };

  const handleJoinGame = async (nick: string, code: string) => {
    try {
      const allSessions = await getGameSessions();
      const targetSession = allSessions.find(s => s.session_name === code && s.session_status === 'waiting');

      if (!targetSession) {
        return setError("Кімнату не знайдено або гра вже почалася");
      }

      setNickname(nick);
      setRoomCode(code);
      setSessionId(targetSession.documentId);
      setIsHost(false);

      const uniqueGuestId = `guest_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
      const guest = await createPlayer({
        player_id: uniqueGuestId,
        nickname: nick,
        session_id: targetSession.documentId,
        players_status: 'joined',
      });
      setPlayerId(guest.documentId);

      setIsLobby(true);
      setDidGameStart(false);
      setIsCreatingLobby(false);
      setPhase(Phases.Main);
      await refreshState();
    } catch (err: any) {
      setError("Помилка приєднання: " + err.message);
    }
  };

  const doGameStart = async () => {
    if (!sessionId) return;
    try {
      await updateGameSession(sessionId, { session_status: 'active' });

      setPlayerCount(players.length);

      const newSheets = [];
      for (const p of players) {
        const sheet = await createStorySheet({
          sheet_id: `sheet_${Math.random().toString(36).substring(2, 9)}`,
          game_session: sessionId,
          player: p.documentId,
          storysheets_status: 'in_progress',
        });
        newSheets.push({ playerId: p.documentId, sheetId: sheet.documentId });
        if (p.documentId === playerId) {
          setMyStorySheetId(sheet.documentId);
        }
      }
      setAllStorySheets(newSheets);

      const ts = new Date().toISOString();
      const firstRound = await createRound({
        round_id: `round_${crypto.randomUUID()}`,
        session_id: sessionId,
        round_number: 1,
        question_type: activeTemplate.questionTypes[0],
        rounds_status: 'active',
        started_at: ts,
      });
      setCurrentRoundDocId(firstRound.documentId);
      setRoundStartedAt(ts);

      setDidGameStart(true);
      setIsLobby(false);
      setPhase(Phases.Main);
      setCurrentRound(1);
      setUserAnswers([]);
      setTotalCount(players.length);
    } catch (err: any) {
      setError("Помилка старту: " + err.message);
    }
  };

  const doShowHistory = () => {
    setPhase(Phases.History);
  };

  const doAnswerSubmit = async (answer: string) => {
    const isMissing = answer.trim() === "" || answer.trim() === "Час вийшов";
    const fallbackPool = activeTemplate.fallbacks[currentRound - 1] ?? [""];
    const cleanAnswer = isMissing
      ? fallbackPool[Math.floor(Math.random() * fallbackPool.length)]
      : answer;

    const updatedAnswers = [...userAnswers, cleanAnswer];
    setUserAnswers(updatedAnswers);

    if (!currentRoundDocId || !playerId || !sessionId) {
      transitionLockRef.current = false;
      setPhase(Phases.Waiting);
      setTimeout(() => {
        if (currentRound < activeTemplate.questions.length) {
          setCurrentRound(prev => prev + 1);
          transitionLockRef.current = false;
          setPhase(Phases.Main);
        } else {
          setAllStories([{
            playerName: nickname,
            story: activeTemplate.buildStory(updatedAnswers, language),
            answers: updatedAnswers,
            templateId: activeTemplate.id
          }]);
          setPhase(Phases.End);
        }
      }, 2000);
      return;
    }

    try {
      let safeSheets = allStorySheets;

      if (safeSheets.length === 0) {
        const fetched = await getStorySheetsBySession(sessionId);
        safeSheets = fetched.map((s: any) => ({ playerId: s.player?.documentId, sheetId: s.documentId }));
        if (safeSheets.length > 0) setAllStorySheets(safeSheets);
      }

      let targetSheet = myStorySheetId || safeSheets.find(s => s.playerId === playerId)?.sheetId;

      if (safeSheets.length > 0 && players.length > 0) {
        const sortedPlayers = [...players].sort((a, b) => a.documentId.localeCompare(b.documentId));
        const myIndex = sortedPlayers.findIndex(p => p.documentId === playerId);
        let targetIndex = (myIndex - (currentRound - 1)) % sortedPlayers.length;
        if (targetIndex < 0) targetIndex += sortedPlayers.length;

        const targetPlayerId = sortedPlayers[targetIndex]?.documentId;
        targetSheet = safeSheets.find(s => s.playerId === targetPlayerId)?.sheetId || targetSheet;
      }

      await submitAnswer({
        answer_id: `ans_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        answer_text: cleanAnswer,
        position_in_sheet: currentRound,
        player: playerId,
        round: currentRoundDocId,
        story_sheet: targetSheet,
      });

      const curAnswers = await getAnswersByRound(currentRoundDocId);
      setJoinedCount(curAnswers.length);
      setTotalCount(playerCount > 0 ? playerCount : players.length);

      transitionLockRef.current = false;
      setPhase(Phases.Waiting);
    } catch (err: any) { }
  };

  return (
    <div className="app-view">
      {roomCode && !didGameStart && phase !== Phases.Join && phase !== Phases.History && phase !== Phases.End && (
        <GameCode code={roomCode} className="gameCodePos" />
      )}

      {!didGameStart && !isCreatingLobby && phase === Phases.Main && !isLobby && (
        <>
          <div className="logo-wrapper">
            <img src={logoImage} alt="Чепуха Лого" className="logo" />
            <div className="logo-boy-hitbox hitbox-1" onClick={playSecretMusic} />
            <div className="logo-boy-hitbox hitbox-2" onClick={playSecretMusic} />
            <div className="logo-boy-hitbox hitbox-3" onClick={playSecretMusic} />
          </div>
          <div className="menu-buttons">
            <Button
              label={t('CREATE_GAME')}
              variant="primary"
              phase={phase}
              onClick={doShowCreateScreen}
            />
            <Button
              label={t('JOIN_GAME')}
              variant="primary"
              phase={phase}
              onClick={doShowJoinScreen}
            />
            <Button
              label={t('HISTORY')}
              variant="primary"
              phase={phase}
              onClick={doShowHistory}
            />
          </div>

          <div className="language-selector">
            <button
              className={`lang-btn ${language === 'uk' ? 'active' : ''}`}
              onClick={() => setLanguage('uk')}
            >
              <img src={flagUk} alt="UK" style={{ width: '126px', height: '84px', objectFit: 'cover' }} />
            </button>
            <button
              className={`lang-btn ${language === 'en' ? 'active' : ''}`}
              onClick={() => setLanguage('en')}
            >
              <img src={flagEn} alt="EN" style={{ width: '126px', height: '84px', objectFit: 'cover' }} />
            </button>
          </div>
        </>
      )}

      {!didGameStart && isCreatingLobby && !isLobby && phase !== Phases.Join && (
        <>
          <div className="yellow-guy-bg" onClick={playSecretMusic} />
          <div className="red-guy-bg" onClick={playSecretMusic} />

          <div className="create-game-container">
            <div className="input-wrapper">
              <input
                type="text"
                className={`nickname-input ${error ? "error" : ""}`}
                placeholder={t('ENTER_NICK_PLACEHOLDER')}
                value={nickname}
                onChange={handleNicknameChange}
              />
            </div>

            <span className="error-message" style={{ minHeight: '24px', display: 'block' }}>{error || '\u00A0'}</span>

            <div className="template-selector">
              <h3 className="template-title">{t('CHOOSE_STORY')}</h3>
              <div className="template-cards-container">
                {Object.values(TEMPLATES).map((tpl) => (
                  <div
                    key={tpl.id}
                    className={`template-card ${selectedTemplate === tpl.id ? 'active' : ''}`}
                    onClick={() => setSelectedTemplate(tpl.id)}
                  >
                    <div className="template-card-content">
                      <h4 className="template-name">{t(tpl.id.toUpperCase() as any) || tpl.name}</h4>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button
              label={t('CREATE_GAME')}
              variant="primary"
              phase={phase}
              onClick={goToLobby}
            />
          </div>

          <HomeIcon className="homeIconPos" onClick={goHome} />
        </>
      )}

      {!didGameStart && isLobby && phase !== Phases.Join && (
        <>
          <div className="lobby-container">
            <div className="lobby-info">
              <h2 className="lobby-text">{t('YOUR_NICK')} {nickname}</h2>
              <h3 className="lobby-subtitle">{t('PLAYER_LIST')}</h3>
              <div className="players-list">
                {players.length > 0 ? (
                  players.map((p, i) => (
                    <div key={p.documentId || String(i)} className="player-item">
                      {i === 0 && <img src={crownImage} alt="Host" className="crown-icon" />}
                      <span className="player-name">{p.nickname}</span>
                    </div>
                  ))
                ) : (
                  <div className="player-item">
                    <img src={crownImage} alt="Host" className="crown-icon" />
                    <span className="player-name">{nickname}</span>
                  </div>
                )}
              </div>
            </div>
            <div className="error-message" style={{ color: "red", minHeight: '24px' }}>{pollError || '\u00A0'}</div>

            <div className="lobby-actions">
              {isHost ? (
                <Button label={t('START_GAME')} variant="primary" phase={phase} onClick={doGameStart} disabled={players.length < 1} />
              ) : (
                <h3 style={{ fontFamily: 'Caveat', fontSize: '2rem', color: '#8b0000' }}>{t('WAITING_HOST')}</h3>
              )}
            </div>
          </div>
          <HomeIcon className="homeIconPos" onClick={goHome} />
        </>
      )}

      {phase === Phases.Join && (
        <JoinCard
          onJoin={handleJoinGame}
          onHome={goHome}
        />
      )}

      {didGameStart && phase === Phases.Waiting && (
        <WaitCard
          nick={nickname}
          joinedCount={joinedCount}
          totalCount={totalCount}
          message={t('WAITING_ANSWERS')}
        />
      )}

      {didGameStart && phase === Phases.Main && (
        <>
          <Timer
            key={`${currentRound}-${roundStartedAt}`}
            initialSeconds={roundStartedAt
              ? Math.max(0, 120 - Math.floor((Date.now() - Date.parse(roundStartedAt)) / 1000))
              : 120
            }
            onTimeUp={() => doAnswerSubmit("Час вийшов")}
            className="timerPos"
          />
          <Round currentRound={currentRound} totalRounds={activeTemplate.questions.length} className="roundPos" />
          <RoundCard
            playerName={nickname}
            phase={phase}
            question={activeTemplate.questions[currentRound - 1]}
            playerReady={1}
            playerTotal={totalCount}
            onSubmitAnswer={doAnswerSubmit}
          />
        </>
      )}

      {phase === Phases.End && (
        <GameResult
          stories={allStories}
          storyIndex={storyIndex}
          onPrev={() => setStoryIndex(i => Math.max(0, i - 1))}
          onNext={() => setStoryIndex(i => Math.min(allStories.length - 1, i + 1))}
          myNickname={nickname}
          phase={phase}
          onHome={goHome}
          onSave={() => { }}
        />
      )}

      {phase === Phases.History && !selectedHistoryGame && (
        <HistoryScreen
          games={savedGames}
          onSelectGame={(g) => {
            setAllStories(g.stories);
            setStoryIndex(0);
            setSelectedHistoryGame(g);
          }}
          onHome={goHome}
        />
      )}

      {phase === Phases.History && selectedHistoryGame && (
        <GameResult
          stories={allStories}
          storyIndex={storyIndex}
          onPrev={() => setStoryIndex(i => Math.max(0, i - 1))}
          onNext={() => setStoryIndex(i => Math.min(allStories.length - 1, i + 1))}
          myNickname={nickname || "Гравець"}
          phase={phase}
          onHome={() => setSelectedHistoryGame(null)}
        />
      )}
    </div>
  );
}

export default App;
