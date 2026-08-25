const semesterButtons =
  document.querySelectorAll(".semester-btn");

const examRows =
  document.querySelectorAll(".exam-row");


semesterButtons.forEach(button => {

  button.addEventListener("click", () => {

    const selectedSemester =
      button.dataset.semester;


    /* Update active button */

    semesterButtons.forEach(btn => {
      btn.classList.remove("active");
    });

    button.classList.add("active");


    /* Filter exams */

    examRows.forEach(row => {

      const rowSemester =
        row.dataset.semester;

      if (
        selectedSemester === "all" ||
        rowSemester === selectedSemester
      ) {

        row.style.display = "grid";

      } else {

        row.style.display = "none";

      }

    });

  });

});

// Auto-filter from URL query param (e.g. ?semester=IV)
(function autoFilterFromURL() {
  const params = new URLSearchParams(window.location.search);
  const sem = params.get('semester');
  if (sem) {
    const targetBtn = Array.from(semesterButtons).find(
      btn => btn.dataset.semester === sem
    );
    if (targetBtn) {
      targetBtn.click();
    }
  }
})();