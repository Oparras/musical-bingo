// server/bingoUtils.js

function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function generateBingoCard(playlist, size = 16) {
  if (playlist.length < size) {
    throw new Error('Playlist does not have enough songs for the card size');
  }
  
  const shuffled = shuffleArray(playlist);
  const selected = shuffled.slice(0, size);
  
  return selected.map(song => ({
    songId: song.id,
    name: song.name,
    artist: song.artist,
    imageUrl: song.imageUrl || null,
    marked: false
  }));
}

function checkWin(card, playedSongs, markedIndexes, type) {
  const gridSize = 4; 
  
  // 1. Check if any marked songs haven't actually been played
  const invalidIndexes = markedIndexes.filter(idx => {
    const songId = card[idx].songId;
    return !playedSongs.includes(songId);
  });

  if (invalidIndexes.length > 0) {
    return { 
      success: false, 
      reason: 'INVALID_MARKS', 
      invalidIndexes 
    };
  }

  const isMarked = (idx) => markedIndexes.includes(idx);

  // 2. Full Card (BINGO)
  if (type === 'BINGO') {
    if (markedIndexes.length === 16) {
      return { success: true };
    }
    return { success: false, reason: 'INCOMPLETE_BINGO' };
  }

  // 3. Line (LINE)
  if (type === 'LINE') {
    // Check rows
    for (let r = 0; r < gridSize; r++) {
      let rowWin = true;
      for (let c = 0; c < gridSize; c++) {
        if (!isMarked(r * gridSize + c)) rowWin = false;
      }
      if (rowWin) return { success: true };
    }

    // Check cols
    for (let c = 0; c < gridSize; c++) {
      let colWin = true;
      for (let r = 0; r < gridSize; r++) {
        if (!isMarked(r * gridSize + c)) colWin = false;
      }
      if (colWin) return { success: true };
    }

    // Check diagonals
    let diag1Win = true;
    let diag2Win = true;
    for (let i = 0; i < gridSize; i++) {
        if (!isMarked(i * gridSize + i)) diag1Win = false;
        if (!isMarked(i * gridSize + (gridSize - 1 - i))) diag2Win = false;
    }
    if (diag1Win || diag2Win) return { success: true };

    return { success: false, reason: 'INCOMPLETE_LINE' };
  }

  return { success: false, reason: 'UNKNOWN_TYPE' };
}

module.exports = {
  generateBingoCard,
  checkWin
};
