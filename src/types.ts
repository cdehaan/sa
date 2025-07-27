export interface Player {
    socket: string;
    playerKey: number;
    playerSecret: string;
}

export interface PlayerData {
    playerName: string;
    playerIndex: number;
    playerKey: number;
    playerChoice: number | null;
    playerScore: number;
    playerSecret?: string;
    active: boolean;
}

export interface Card {
    card_key: number;
    [key: string]: any; // Allow for other card properties
    questions?: Question[];
}

export interface Question {
    question_key: number;
    card_key: number;
    question_text: string;
    [key: string]: any; // Allow for other question properties
}

export interface RoomData {
    roomCode: string;
    roomCorrectAnswer: number;
    roomCurrentPlayer: number;
    roomCardKey: number;
    roomQuestionRevealed: number;
    last_action: string;
    roomGameState: number;
    roomCard?: Card;
}

export interface RequestData {
    playerName: string;
    clean?: boolean;
    error?: string;
}

export interface JoinData {
    playerName: string;
    roomCode: string;
    playerKey?: number;
    playerSecret?: string;
    clean?: boolean;
    error?: string;
}

export interface RejoinData {
    playerKey: number;
    playerSecret: string;
    clean?: boolean;
    error?: string;
}

export interface LeaveData {
    playerKey: number;
    playerSecret: string;
    clean?: boolean;
    error?: string;
}

export interface StartData {
    roomCode: string;
    playerKey: number;
    playerSecret: string;
    clean?: boolean;
    error?: string;
}

export interface GuessData {
    roomCode: string;
    playerKey: number;
    playerSecret: string;
    questionIndex: number;
    clean?: boolean;
    error?: string;
}

export interface RevealData {
    playerKey: number;
    playerSecret: string;
    roomCode: string;
    clean?: boolean;
    error?: string;
}

export interface ProgressData {
    playerKey: number;
    playerSecret: string;
    roomCode: string;
    clean?: boolean;
    error?: string;
}

export interface ReturnData {
    success: boolean;
    error?: string;
    playerKey?: number;
    playerSecret?: string;
    roomData?: RoomData;
    playerList?: PlayerData[];
    card?: Card;
    questions?: Question[];
    questionIndex?: number;
    currentPlayerIndex?: number;
}

export interface AllowedInput {
    name: string;
    type: string;
}

export interface VerificationResults {
    verified: boolean;
    error?: string;
}

export interface PlayerVerificationData {
    playerKey: number;
    playerSecret: string;
    roomCode?: string;
}