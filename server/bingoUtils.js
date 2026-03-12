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
  
  // 1. Check for invalid marks (songs not yet played)
  const playedSet = new Set(playedSongs.map(id => String(id)));
  
  const invalidIndexes = markedIndexes.filter(idx => {
    if (!card[idx]) return false;
    const songId = String(card[idx].songId);
    return !playedSet.has(songId);
  });

  if (invalidIndexes.length > 0) {
    return { 
      success: false, 
      reason: 'INVALID_MARKS', 
      invalidIndexes 
    };
  }

  const isMarked = (idx) => markedIndexes.includes(idx);

  // 2. BINGO (All 16)
  if (type === 'BINGO') {
    if (markedIndexes.length >= 16) {
      return { success: true };
    }
    return { success: false, reason: 'INCOMPLETE_BINGO' };
  }

  // 3. LINE (One line of 4)
  if (type === 'LINE') {
    // Rows
    for (let r = 0; r < gridSize; r++) {
      let rowMatch = true;
      for (let c = 0; c < gridSize; c++) {
        if (!isMarked(r * gridSize + c)) rowMatch = false;
      }
      if (rowMatch) return { success: true };
    }

    // Columns
    for (let c = 0; c < gridSize; c++) {
      let colMatch = true;
      for (let r = 0; r < gridSize; r++) {
        if (!isMarked(r * gridSize + c)) colMatch = false;
      }
      if (colMatch) return { success: true };
    }

    // Diagonals
    let d1 = true, d2 = true;
    for (let i = 0; i < gridSize; i++) {
      if (!isMarked(i * gridSize + i)) d1 = false;
      if (!isMarked(i * gridSize + (gridSize - 1 - i))) d2 = false;
    }
    if (d1 || d2) return { success: true };

    return { success: false, reason: 'INCOMPLETE_LINE' };
  }

  return { success: false, reason: 'UNKNOWN_TYPE' };
}

module.exports = {
  generateBingoCard,
  checkWin
};
