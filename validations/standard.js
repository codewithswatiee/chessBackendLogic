export class StandardChessValidator {
    constructor() {
        // Initialize with standard starting position
        this.board = this.getStartingPosition();
        this.gameState = {
            currentPlayer: 'white',
            castlingRights: {
                white: { kingside: true, queenside: true },
                black: { kingside: true, queenside: true }
            },
            enPassantTarget: null,
            halfmoveClock: 0,
            fullmoveNumber: 1,
            lastMove: null
        };
    }

    getStartingPosition() {
        return [
            ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'], // rank 8 (black)
            ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'], // rank 7
            [null, null, null, null, null, null, null, null], // rank 6
            [null, null, null, null, null, null, null, null], // rank 5
            [null, null, null, null, null, null, null, null], // rank 4
            [null, null, null, null, null, null, null, null], // rank 3
            ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'], // rank 2
            ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']  // rank 1 (white)
        ];
    }

    /**
     * Main validation function - validates a chess move
     * @param {string|Object} from - Source square (e.g., 'e2' or {row: 6, col: 4})
     * @param {string|Object} to - Destination square (e.g., 'e4' or {row: 4, col: 4})
     * @param {string} promotionPiece - Piece to promote to (optional)
     * @returns {Object} - Validation result with success flag and details
     */
    validateMove(from, to, promotionPiece = null) {
        try {
            // Convert algebraic notation to coordinates if needed
            const fromCoords = this.parseSquare(from);
            const toCoords = this.parseSquare(to);

            // Basic validation
            const basicValidation = this.validateBasicMove(fromCoords, toCoords);
            if (!basicValidation.isValid) {
                return { isValid: false, error: basicValidation.error };
            }

            const piece = this.board[fromCoords.row][fromCoords.col];
            
            // Piece-specific validation
            const pieceValidation = this.validatePieceMove(fromCoords, toCoords, piece);
            if (!pieceValidation.isValid) {
                return { isValid: false, error: pieceValidation.error };
            }

            // Check if move leaves king in check
            const checkValidation = this.validateKingSafety(fromCoords, toCoords);
            if (!checkValidation.isValid) {
                return { isValid: false, error: checkValidation.error };
            }

            // Validate special moves
            const specialValidation = this.validateSpecialMoves(fromCoords, toCoords, piece, promotionPiece);
            if (!specialValidation.isValid) {
                return { isValid: false, error: specialValidation.error };
            }

            return { 
                isValid: true, 
                moveType: this.getMoveType(fromCoords, toCoords, piece),
                captures: this.board[toCoords.row][toCoords.col] !== null,
                isCheck: this.wouldCauseCheck(fromCoords, toCoords),
                isCheckmate: this.wouldCauseCheckmate(fromCoords, toCoords),
                isStalemate: this.wouldCauseStalemate(fromCoords, toCoords)
            };

        } catch (error) {
            return { isValid: false, error: error.message };
        }
    }

    /**
     * Parse square notation to coordinates
     */
    parseSquare(square) {
        if (typeof square === 'object' && square.row !== undefined && square.col !== undefined) {
            return square;
        }
        
        if (typeof square !== 'string' || square.length !== 2) {
            throw new Error('Invalid square notation');
        }

        const file = square.charCodeAt(0) - 97; // 'a' = 0
        const rank = 8 - parseInt(square[1]); // '8' = 0
        
        if (file < 0 || file > 7 || rank < 0 || rank > 7) {
            throw new Error('Square out of bounds');
        }

        return { row: rank, col: file };
    }

    /**
     * Basic move validation
     */
    validateBasicMove(from, to) {
        // Check if squares are valid
        if (!this.isValidSquare(from.row, from.col) || !this.isValidSquare(to.row, to.col)) {
            return { isValid: false, error: 'Invalid square coordinates' };
        }

        // Check if there's a piece to move
        const piece = this.board[from.row][from.col];
        if (!piece) {
            return { isValid: false, error: 'No piece at source square' };
        }

        // Check if it's the correct player's turn
        if (!this.isPieceColor(piece, this.gameState.currentPlayer)) {
            return { isValid: false, error: 'Not your turn' };
        }

        // Check if trying to move to same square
        if (from.row === to.row && from.col === to.col) {
            return { isValid: false, error: 'Cannot move to same square' };
        }

        // Check if destination has own piece
        const destPiece = this.board[to.row][to.col];
        if (destPiece && this.isPieceColor(destPiece, this.gameState.currentPlayer)) {
            return { isValid: false, error: 'Cannot capture own piece' };
        }

        return { isValid: true };
    }

    /**
     * Piece-specific move validation
     */
    validatePieceMove(from, to, piece) {
        const pieceType = piece.toLowerCase();
        
        switch (pieceType) {
            case 'p':
                return this.validatePawnMove(from, to, piece);
            case 'r':
                return this.validateRookMove(from, to);
            case 'n':
                return this.validateKnightMove(from, to);
            case 'b':
                return this.validateBishopMove(from, to);
            case 'q':
                return this.validateQueenMove(from, to);
            case 'k':
                return this.validateKingMove(from, to);
            default:
                return { isValid: false, error: 'Invalid piece type' };
        }
    }

    /**
     * Pawn move validation
     */
    validatePawnMove(from, to, piece) {
        const isWhite = this.isWhitePiece(piece);
        const direction = isWhite ? -1 : 1;
        const startRank = isWhite ? 6 : 1;
        const rowDiff = to.row - from.row;
        const colDiff = to.col - from.col;

        // Forward move
        if (colDiff === 0) {
            if (this.board[to.row][to.col] !== null) {
                return { isValid: false, error: 'Pawn cannot capture forward' };
            }
            
            // One square forward
            if (rowDiff === direction) {
                return { isValid: true };
            }
            
            // Two squares forward from starting position
            if (from.row === startRank && rowDiff === 2 * direction) {
                return { isValid: true };
            }
            
            return { isValid: false, error: 'Invalid pawn move' };
        }

        // Diagonal capture
        if (Math.abs(colDiff) === 1 && rowDiff === direction) {
            const targetPiece = this.board[to.row][to.col];
            
            // Normal capture
            if (targetPiece && !this.isPieceColor(targetPiece, this.gameState.currentPlayer)) {
                return { isValid: true };
            }
            
            // En passant
            if (this.isValidEnPassant(from, to)) {
                return { isValid: true };
            }
            
            return { isValid: false, error: 'Pawn cannot capture empty square' };
        }

        return { isValid: false, error: 'Invalid pawn move' };
    }

    /**
     * Rook move validation
     */
    validateRookMove(from, to) {
        const rowDiff = to.row - from.row;
        const colDiff = to.col - from.col;

        // Must move in straight line
        if (rowDiff !== 0 && colDiff !== 0) {
            return { isValid: false, error: 'Rook must move in straight line' };
        }

        // Check path is clear
        if (!this.isPathClear(from, to)) {
            return { isValid: false, error: 'Path blocked' };
        }

        return { isValid: true };
    }

    /**
     * Knight move validation
     */
    validateKnightMove(from, to) {
        const rowDiff = Math.abs(to.row - from.row);
        const colDiff = Math.abs(to.col - from.col);

        if (!((rowDiff === 2 && colDiff === 1) || (rowDiff === 1 && colDiff === 2))) {
            return { isValid: false, error: 'Invalid knight move' };
        }

        return { isValid: true };
    }

    /**
     * Bishop move validation
     */
    validateBishopMove(from, to) {
        const rowDiff = Math.abs(to.row - from.row);
        const colDiff = Math.abs(to.col - from.col);

        // Must move diagonally
        if (rowDiff !== colDiff) {
            return { isValid: false, error: 'Bishop must move diagonally' };
        }

        // Check path is clear
        if (!this.isPathClear(from, to)) {
            return { isValid: false, error: 'Path blocked' };
        }

        return { isValid: true };
    }

    /**
     * Queen move validation
     */
    validateQueenMove(from, to) {
        const rookMove = this.validateRookMove(from, to);
        const bishopMove = this.validateBishopMove(from, to);

        if (!rookMove.isValid && !bishopMove.isValid) {
            return { isValid: false, error: 'Invalid queen move' };
        }

        return { isValid: true };
    }

    /**
     * King move validation
     */
    validateKingMove(from, to) {
        const rowDiff = Math.abs(to.row - from.row);
        const colDiff = Math.abs(to.col - from.col);

        // Normal king move (one square)
        if (rowDiff <= 1 && colDiff <= 1) {
            return { isValid: true };
        }

        // Castling (two squares horizontally)
        if (rowDiff === 0 && colDiff === 2) {
            return this.validateCastling(from, to);
        }

        return { isValid: false, error: 'Invalid king move' };
    }

    /**
     * Castling validation
     */
    validateCastling(from, to) {
        const color = this.gameState.currentPlayer;
        const kingRow = color === 'white' ? 7 : 0;

        // King must be on starting square
        if (from.row !== kingRow || from.col !== 4) {
            return { isValid: false, error: 'King not on starting square' };
        }

        // Determine castling side
        const isKingside = to.col === 6;
        const isQueenside = to.col === 2;

        if (!isKingside && !isQueenside) {
            return { isValid: false, error: 'Invalid castling destination' };
        }

        // Check castling rights
        const castlingRights = this.gameState.castlingRights[color];
        if ((isKingside && !castlingRights.kingside) || 
            (isQueenside && !castlingRights.queenside)) {
            return { isValid: false, error: 'Castling rights lost' };
        }

        // King must not be in check
        if (this.isInCheck(color)) {
            return { isValid: false, error: 'Cannot castle while in check' };
        }

        // Check if rook is present
        const rookCol = isKingside ? 7 : 0;
        const expectedRook = color === 'white' ? 'R' : 'r';
        if (this.board[kingRow][rookCol] !== expectedRook) {
            return { isValid: false, error: 'Rook not in position' };
        }

        // Check path is clear
        const minCol = Math.min(from.col, to.col);
        const maxCol = Math.max(from.col, to.col);
        
        for (let col = minCol + 1; col < maxCol; col++) {
            if (this.board[kingRow][col] !== null) {
                return { isValid: false, error: 'Castling path blocked' };
            }
        }

        // Check king doesn't pass through check
        const direction = isKingside ? 1 : -1;
        for (let col = from.col; col !== to.col + direction; col += direction) {
            if (this.isSquareAttacked(kingRow, col, this.getOpponentColor(color))) {
                return { isValid: false, error: 'King passes through check' };
            }
        }

        return { isValid: true };
    }

    /**
     * En passant validation
     */
    isValidEnPassant(from, to) {
        if (!this.gameState.enPassantTarget) {
            return false;
        }

        const enPassantCoords = this.parseSquare(this.gameState.enPassantTarget);
        return to.row === enPassantCoords.row && to.col === enPassantCoords.col;
    }

    /**
     * King safety validation
     */
    validateKingSafety(from, to) {
        if (this.wouldLeaveKingInCheck(from, to)) {
            return { isValid: false, error: 'Move leaves king in check' };
        }
        return { isValid: true };
    }

    /**
     * Special moves validation
     */
    validateSpecialMoves(from, to, piece, promotionPiece) {
        const pieceType = piece.toLowerCase();

        // Pawn promotion validation
        if (pieceType === 'p' && (to.row === 0 || to.row === 7)) {
            if (!promotionPiece) {
                return { isValid: false, error: 'Promotion piece required' };
            }
            
            const validPromotions = ['q', 'r', 'b', 'n'];
            if (!validPromotions.includes(promotionPiece.toLowerCase())) {
                return { isValid: false, error: 'Invalid promotion piece' };
            }
        }

        // Ensure no promotion on non-promotion moves
        if (promotionPiece && (pieceType !== 'p' || (to.row !== 0 && to.row !== 7))) {
            return { isValid: false, error: 'Cannot promote on this move' };
        }

        return { isValid: true };
    }

    /**
     * Utility functions
     */
    isValidSquare(row, col) {
        return row >= 0 && row < 8 && col >= 0 && col < 8;
    }

    isWhitePiece(piece) {
        return piece && piece === piece.toUpperCase();
    }

    isBlackPiece(piece) {
        return piece && piece === piece.toLowerCase();
    }

    isPieceColor(piece, color) {
        if (!piece) return false;
        return color === 'white' ? this.isWhitePiece(piece) : this.isBlackPiece(piece);
    }

    getOpponentColor(color) {
        return color === 'white' ? 'black' : 'white';
    }

    isPathClear(from, to) {
        const rowStep = Math.sign(to.row - from.row);
        const colStep = Math.sign(to.col - from.col);
        
        let currentRow = from.row + rowStep;
        let currentCol = from.col + colStep;
        
        while (currentRow !== to.row || currentCol !== to.col) {
            if (this.board[currentRow][currentCol] !== null) {
                return false;
            }
            currentRow += rowStep;
            currentCol += colStep;
        }
        
        return true;
    }

    wouldLeaveKingInCheck(from, to) {
        // Make temporary move
        const originalPiece = this.board[to.row][to.col];
        const movingPiece = this.board[from.row][from.col];
        
        this.board[to.row][to.col] = movingPiece;
        this.board[from.row][from.col] = null;
        
        // Check if king is in check after move
        const inCheck = this.isInCheck(this.gameState.currentPlayer);
        
        // Restore board
        this.board[from.row][from.col] = movingPiece;
        this.board[to.row][to.col] = originalPiece;
        
        return inCheck;
    }

    isInCheck(color) {
        const kingPos = this.findKing(color);
        if (!kingPos) return false;
        
        return this.isSquareAttacked(kingPos.row, kingPos.col, this.getOpponentColor(color));
    }

    findKing(color) {
        const kingPiece = color === 'white' ? 'K' : 'k';
        
        for (let row = 0; row < 8; row++) {
            for (let col = 0; col < 8; col++) {
                if (this.board[row][col] === kingPiece) {
                    return { row, col };
                }
            }
        }
        return null;
    }

    isSquareAttacked(row, col, attackingColor) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (piece && this.isPieceColor(piece, attackingColor)) {
                    if (this.canPieceAttackSquare({ row: r, col: c }, { row, col }, piece)) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    canPieceAttackSquare(from, to, piece) {
        const pieceType = piece.toLowerCase();
        
        // For pawns, use special attack logic
        if (pieceType === 'p') {
            const isWhite = this.isWhitePiece(piece);
            const direction = isWhite ? -1 : 1;
            const rowDiff = to.row - from.row;
            const colDiff = Math.abs(to.col - from.col);
            
            return rowDiff === direction && colDiff === 1;
        }
        
        // For other pieces, temporarily remove target piece and check validity
        const originalPiece = this.board[to.row][to.col];
        this.board[to.row][to.col] = null;
        
        const canAttack = this.validatePieceMove(from, to, piece).isValid;
        
        this.board[to.row][to.col] = originalPiece;
        
        return canAttack;
    }

    getMoveType(from, to, piece) {
        const pieceType = piece.toLowerCase();
        
        if (pieceType === 'k' && Math.abs(to.col - from.col) === 2) {
            return to.col > from.col ? 'castling_kingside' : 'castling_queenside';
        }
        
        if (pieceType === 'p' && this.isValidEnPassant(from, to)) {
            return 'en_passant';
        }
        
        if (pieceType === 'p' && (to.row === 0 || to.row === 7)) {
            return 'promotion';
        }
        
        if (this.board[to.row][to.col] !== null) {
            return 'capture';
        }
        
        return 'normal';
    }

    wouldCauseCheck(from, to) {
        // Make temporary move
        const originalPiece = this.board[to.row][to.col];
        const movingPiece = this.board[from.row][from.col];
        
        this.board[to.row][to.col] = movingPiece;
        this.board[from.row][from.col] = null;
        
        const opponentColor = this.getOpponentColor(this.gameState.currentPlayer);
        const causesCheck = this.isInCheck(opponentColor);
        
        // Restore board
        this.board[from.row][from.col] = movingPiece;
        this.board[to.row][to.col] = originalPiece;
        
        return causesCheck;
    }

    wouldCauseCheckmate(from, to) {
        // This is a simplified check - full implementation would require
        // checking all possible opponent moves after this move
        return false;
    }

    wouldCauseStalemate(from, to) {
        // This is a simplified check - full implementation would require
        // checking all possible opponent moves after this move
        return false;
    }

    /**
     * Update game state after a move (for use with actual game)
     */
    updateGameState(from, to, piece, capturedPiece) {
        const pieceType = piece.toLowerCase();
        
        // Update castling rights
        if (pieceType === 'k') {
            this.gameState.castlingRights[this.gameState.currentPlayer] = { kingside: false, queenside: false };
        }
        
        if (pieceType === 'r') {
            const color = this.gameState.currentPlayer;
            if (from.row === (color === 'white' ? 7 : 0)) {
                if (from.col === 0) {
                    this.gameState.castlingRights[color].queenside = false;
                } else if (from.col === 7) {
                    this.gameState.castlingRights[color].kingside = false;
                }
            }
        }
        
        // Update en passant target
        if (pieceType === 'p' && Math.abs(to.row - from.row) === 2) {
            const enPassantRow = (from.row + to.row) / 2;
            const file = String.fromCharCode(97 + to.col);
            const rank = (8 - enPassantRow).toString();
            this.gameState.enPassantTarget = file + rank;
        } else {
            this.gameState.enPassantTarget = null;
        }
        
        // Update halfmove clock
        if (pieceType === 'p' || capturedPiece) {
            this.gameState.halfmoveClock = 0;
        } else {
            this.gameState.halfmoveClock++;
        }
        
        // Update fullmove number
        if (this.gameState.currentPlayer === 'black') {
            this.gameState.fullmoveNumber++;
        }
        
        // Switch players
        this.gameState.currentPlayer = this.getOpponentColor(this.gameState.currentPlayer);
    }
}