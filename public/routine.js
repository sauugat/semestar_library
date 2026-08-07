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