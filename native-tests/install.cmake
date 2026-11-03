set(stage "${BUILD_DIR}/installed-consumer-check")
file(REMOVE_RECURSE "${stage}")
function(check_command)
    execute_process(COMMAND ${ARGV} COMMAND_ERROR_IS_FATAL ANY)
endfunction()
check_command("${CMAKE_COMMAND}" --install "${BUILD_DIR}" --config "${CONFIG}" --prefix "${stage}/prefix")
check_command("${CMAKE_COMMAND}" -S "${SOURCE_DIR}/native-tests/consumer" -B "${stage}/project"
    "-DCMAKE_CXX_COMPILER=${COMPILER}" "-DCMAKE_BUILD_TYPE=${CONFIG}" "-DCMAKE_PREFIX_PATH=${stage}/prefix"
    "-DCMAKE_RUNTIME_OUTPUT_DIRECTORY=${stage}/bin" "-DCMAKE_RUNTIME_OUTPUT_DIRECTORY_${CONFIG_UPPER}=${stage}/bin")
check_command("${CMAKE_COMMAND}" --build "${stage}/project" --config "${CONFIG}")
check_command("${stage}/bin/grader-consumer${EXE_SUFFIX}")
